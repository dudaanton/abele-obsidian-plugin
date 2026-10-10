import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import {
  activeVaultName,
  evalJson,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  vaultCli,
} from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { screenshot, swipe, tap, typeText } from './helpers/phone'
import { withNativeInput } from './helpers/nativeInput'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const mobile = process.env.CANVAS_ACCEPTANCE_MOBILE === '1'
const DIR = 'Sample canvas acceptance'
const SHOTS = shotDir('canvas-acceptance')
const PRELUDE = `
  const path=${JSON.stringify(`${DIR}/Sample diagram.canvas`)}
  const view=()=>app.workspace.getLeavesOfType('abele-canvas').find(l=>l.view.file?.path===path)?.view
  const button=label=>view()?.contentEl.querySelector('[aria-label="'+label+'"]')
  const graph=async()=>JSON.parse(await app.vault.read(app.vault.getAbstractFileByPath(path)))
  const scope=new window.__abeleTest.ScopeResolver();scope.setFullVaultAccess(true)
  const ctx={scope,interactive:true}
  const tools=Object.fromEntries(window.__abeleTest.createAgentTools().map(t=>[t.name,t]))
  const call=async(name,params)=>tools[name].execute('sample-acceptance',params,undefined,ctx)
  const parsed=result=>JSON.parse(result.content[0].text)
  const read=async()=>parsed(await call('canvas_read',{path,detail:'full'}))
  const embed=()=>document.querySelector('.abele-canvas-embed-picture')
  const menuItem=label=>[...document.querySelectorAll('.menu-item')].find(el=>el.textContent.trim()===label)
`
const cli =
  !onPhone() && available ? vaultCli(process.env.OBSIDIAN_TEST_VAULT ?? activeVaultName()) : null
const run = <T>(body: string): T => {
  const expression = `(async()=>{${PRELUDE}return await(async()=>{${body}})()})()`
  return cli
    ? cli.evalAwait<T>(expression, 120_000)
    : evalAsync<T>(`(async()=>JSON.stringify(await ${expression}))()`, 120_000)
}
const until = async (expression: string) => {
  await expect.poll(() => run<boolean>(`return !!(${expression})`), { timeout: 20_000 }).toBe(true)
}
const input = async (from: number[], to = from) => {
  if (onPhone()) {
    if (from[0] === to[0] && from[1] === to[1]) tap(from[0], from[1])
    else swipe(from[0], from[1], to[0], to[1])
  } else
    await withNativeInput(() =>
      run(`
      const cdp=require('@electron/remote').getCurrentWebContents().debugger,owned=!cdp.isAttached();if(owned)cdp.attach('1.3')
      const touch=${mobile},x=${from[0]},y=${from[1]},dx=${to[0] - from[0]},dy=${to[1] - from[1]}
      const send=(type,x,y)=>touch
        ?cdp.sendCommand('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{id:1,x,y}]})
        :cdp.sendCommand('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1})
      try{
        await send(touch?'touchStart':'mousePressed',x,y)
        if(dx||dy)for(let i=1;i<=12;i++){await send(touch?'touchMove':'mouseMoved',x+dx*i/12,y+dy*i/12);await new Promise(r=>setTimeout(r,16))}
        await send(touch?'touchEnd':'mouseReleased',x+dx,y+dy)
        if(touch)await new Promise(r=>setTimeout(r,350)) // Wait for the browser's compatibility click.
        // A notification can appear under the pointer and pause its dismissal while hovered.
        if(!touch)await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:innerHeight-1,buttons:0})
      }finally{if(owned)cdp.detach()}return true
    `)
    )
}
const press = async (expression: string) => {
  const geometry = `const el=${expression};if(!el)return null;const r=el.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);if(!r.width||!r.height||x<0||y<0||x>=innerWidth||y>=innerHeight||!el.contains(document.elementFromPoint(x,y)))return null;return[x,y]`
  let point: number[] | null = null,
    stable = 0
  // Native mobile sheets animate into place. Never touch yesterday's hit rectangle.
  await expect
    .poll(
      () => {
        const next = run<number[] | null>(geometry)
        stable = next && JSON.stringify(next) === JSON.stringify(point) ? stable + 1 : 0
        point = next
        return stable >= 2 ? point : null
      },
      { timeout: 20_000, interval: 150 }
    )
    .not.toBeNull()
  await input(point!)
}
const click = (label: string) => press(`button(${JSON.stringify(label)})`)
const type = async (text: string) => {
  if (onPhone()) {
    await new Promise((r) => setTimeout(r, 500))
    typeText(text)
  } else
    await withNativeInput(() =>
      run(`
      const cdp=require('@electron/remote').getCurrentWebContents().debugger,owned=!cdp.isAttached();if(owned)cdp.attach('1.3')
      try{await cdp.sendCommand('Input.insertText',{text:${JSON.stringify(text)}})}finally{if(owned)cdp.detach()}return true
    `)
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
const saved = () =>
  until(
    "view()?.documentLease&&!view().documentLease.document.session.dirty&&!button('Add text card').disabled"
  )
const fit = async () => {
  await click('Fit diagram')
  await new Promise((r) => setTimeout(r, 350))
}
const notePoint = (): number[] =>
  run(
    `const v=view().viewer,c=v.camera,r=v.stage.getBoundingClientRect(),n=v.graph.nodes.find(n=>n.type==='file');return[Math.round(r.left+(n.x+n.width*0.3-c.x)*c.zoom),Math.round(r.top+(n.y+n.height*0.7-c.y)*c.zoom)]`
  )
const openMenu = () =>
  press('view().containerEl.querySelector(\'[aria-label="Export diagram picture"]\')')
const exportWhole = async (format: string) => {
  await openMenu()
  await press(`menuItem(${JSON.stringify(`Export whole canvas as ${format.toUpperCase()}`)})`)
  await until(`view().lastExport?.extension===${JSON.stringify(format)}&&!view().exportController`)
  return run<string>('return view().lastExport.path')
}

describe.skipIf(!available)('shared human and agent canvas acceptance', () => {
  let size: number[] | null = null
  beforeAll(async () => {
    if (mobile && !onPhone()) {
      size = evalJson<number[]>(`require('@electron/remote').getCurrentWindow().getContentSize()`)
      await reloadApp('app.emulateMobile(true)')
      evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390,844)`)
    } else if (!onPhone()) await reloadApp()
    run(`
      if(app.vault.getAbstractFileByPath(${JSON.stringify(DIR)}))throw Error('Synthetic folder already exists')
      window.__canvasAcceptance={layout:app.workspace.getLayout(),preference:window.__abeleTest.AbeleConfig.getInstance().canvasViewer,location:app.vault.getConfig('newFileLocation'),folder:app.vault.getConfig('attachmentFolderPath')}
      window.__abeleTest.AbeleConfig.getInstance().canvasViewer=true
      await app.vault.createFolder(${JSON.stringify(DIR)});window.__canvasAcceptance.owned=true
      app.vault.setConfig('newFileLocation','current');app.vault.setConfig('attachmentFolderPath',${JSON.stringify(DIR)})
      const note=await app.vault.create(${JSON.stringify(`${DIR}/sample-note.md`)},${JSON.stringify('# Linked concept\n\nA person starts; an agent continues.\n')})
      const leaf=app.workspace.getLeaf('tab');await leaf.openFile(note);await app.workspace.revealLeaf(leaf);return true
    `)
  }, 120_000)
  afterAll(async () => {
    try {
      run(`
        document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
        const state=window.__canvasAcceptance,leaves=[];app.workspace.iterateAllLeaves(l=>{if(l.view.file?.path.startsWith(${JSON.stringify(DIR + '/')}))leaves.push(l)})
        for(const leaf of leaves){leaf.view.documentLease?.document.discardDraft();leaf.detach()}
        if(state?.owned){const dir=app.vault.getAbstractFileByPath(${JSON.stringify(DIR)});if(dir)await app.vault.delete(dir,true)}
        if(state){window.__abeleTest.AbeleConfig.getInstance().canvasViewer=state.preference;app.vault.setConfig('newFileLocation',state.location);app.vault.setConfig('attachmentFolderPath',state.folder);await app.workspace.changeLayout(state.layout)}
        delete window.__canvasAcceptance;return true
      `)
    } finally {
      if (size) {
        await reloadApp('app.emulateMobile(false)')
        evalRaw(
          `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]},${size[1]})`
        )
      }
    }
  }, 120_000)

  it('creates, annotates, moves, continues, renames, embeds and exports one evolving diagram', async () => {
    onTestFailed(() => shot('failure'))
    run("app.commands.executeCommandById('abele:new-canvas');return true")
    await press('document.querySelector(\'[aria-label="Canvas name"]\')')
    await type('Sample diagram')
    await until('document.querySelector(\'[aria-label="Canvas name"]\')?.value==="Sample diagram"')
    await press(
      '[...document.querySelectorAll(".abele-canvas-input button")].find(el=>el.textContent==="Create")'
    )
    await until('view()?.editor')
    expect(run<number>('return (await graph()).nodes.length')).toBe(0)
    await click('Add note or attachment')
    await press('document.querySelector(".prompt-input")')
    await type('sample-note')
    await press(
      `[...document.querySelectorAll('.suggestion-item')].find(el=>el.textContent.includes(${JSON.stringify(`${DIR}/sample-note.md`)}))`
    )
    await saved()
    await click('Canvas drawing tools')
    await click('Draw with pen')
    await fit()
    const start = notePoint()
    await input(start, [start[0] + 50, start[1] + 8])
    await saved()
    const before = run<{ id: string; points: number[]; bounds: { x: number; y: number } }>(
      'return (await read()).ink[0]'
    )
    expect(before.points.length).toBeGreaterThan(6)
    expect(run<number>('return (await graph()).nodes[0].abele.ink.length')).toBe(1)
    const originalNode = run<{ x: number; y: number }>('return (await graph()).nodes[0]')
    await click('Canvas drawing tools')
    const move = notePoint()
    await input(move, [move[0] + 22, move[1] + 16])
    await until(
      `(await graph()).nodes[0].x!==${originalNode.x}&&(await graph()).nodes[0].y!==${originalNode.y}`
    )
    await saved()
    const moved = run<{ same: boolean; dx: number; dy: number; inkDx: number; inkDy: number }>(`
      const n=(await graph()).nodes[0],ink=(await read()).ink[0]
      return{same:JSON.stringify(ink.points)===${JSON.stringify(JSON.stringify(before.points))},dx:n.x-(${originalNode.x}),dy:n.y-(${originalNode.y}),inkDx:ink.bounds.x-(${before.bounds.x}),inkDy:ink.bounds.y-(${before.bounds.y})}
    `)
    expect(moved.same).toBe(true)
    expect(Math.abs(moved.dx)).toBeGreaterThan(1)
    expect(Math.abs(moved.dy)).toBeGreaterThan(1)
    expect(moved.inkDx).toBeCloseTo(moved.dx)
    expect(moved.inkDy).toBeCloseTo(moved.dy)
    run(`
      const n=(await graph()).nodes[0];window.__canvasAcceptance.node=n.id
      await call('canvas_edit',{path,revision:(await read()).revision,ops:[
        {op:'add_node',node:{id:'result',kind:'shape',shape:'pill',label:'Agent continuation',x:n.x+n.width+100,y:n.y,width:260,height:160}},
        {op:'connect',edge:{id:'next',fromNode:n.id,toNode:'result',label:'continue'}},
        {op:'add_ink',node:n.id,stroke:{version:1,id:'agent-ink',tool:'marker',points:[40,110,0.5,150,110,0.5],frame:{width:n.width,height:n.height}}},
      ]})
      await call('canvas_steps',{path,revision:(await read()).revision,ops:[{op:'replace',steps:[
        {id:'start',reveal:[n.id],focus:n.id,say:'Start with the linked concept and its annotation.'},
        {id:'continue',reveal:['result'],highlight:['result','next'],say:'Continue with the result.'},
      ]}]})
      return true
    `)
    await until('view().viewer.graph.nodes.length===2')
    expect(run<string[]>('return (await read()).ink.map(s=>s.id)')).toEqual(
      expect.arrayContaining([before.id, 'agent-ink'])
    )
    // Rename via the host's normal rename UI, then open through the canvas action.
    run(
      `app.fileManager.promptForFileRename(app.vault.getAbstractFileByPath(${JSON.stringify(`${DIR}/sample-note.md`)}));return true`
    )
    await until('document.activeElement?.matches(".rename-textarea")')
    await type('sample-renamed')
    expect(run<string>('return document.activeElement.value')).toBe('sample-renamed')
    await press(
      '[...document.querySelectorAll(".mod-file-rename button")].find(el=>el.textContent==="Save")'
    )
    await until(
      `view().viewer.graph.nodes.some(n=>n.file===${JSON.stringify(`${DIR}/sample-renamed.md`)})`
    )
    await until('!document.querySelector(".notice")')
    await fit()
    await input(notePoint())
    await click('Open selected card')
    await until(
      `app.workspace.getActiveFile()?.path===${JSON.stringify(`${DIR}/sample-renamed.md`)}`
    )
    run('await app.workspace.revealLeaf(view().leaf);return true')
    await fit()
    shot('canvas')

    run(`
      const note=await app.vault.create(${JSON.stringify(`${DIR}/sample-embed.md`)},${JSON.stringify('# Living explanation\n\n![[Sample diagram.canvas]]\n\nThe picture follows the diagram.\n')})
      const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'markdown',state:{file:note.path,mode:'preview'},active:true});await app.workspace.revealLeaf(leaf);window.__canvasAcceptance.embedLeaf=leaf;return true
    `)
    await until('embed()?.complete&&embed()?.naturalWidth>0')
    run('window.__canvasAcceptance.oldPicture=embed().src;return true')
    run(
      `await call('canvas_edit',{path,revision:(await read()).revision,ops:[{op:'update',id:'result',patch:{text:'Updated agent continuation'}}]});return true`
    )
    await until(
      'embed()?.complete&&embed()?.naturalWidth>0&&embed().src!==window.__canvasAcceptance.oldPicture'
    )
    expect(
      run<boolean>(`
      const result=await call('look_at_canvas',{path,maxSide:1600})
      return embed().src===result.injectMessages[0].content.find(c=>c.type==='image_url').image_url.url
    `)
    ).toBe(true)
    shot('embedded-reading')
    run(
      'await window.__canvasAcceptance.embedLeaf.view.setState({mode:"source",source:false},{});window.__canvasAcceptance.embedLeaf.view.editor.setCursor({line:4,ch:0});return true'
    )
    await until('embed()?.complete&&embed()?.naturalWidth>0')
    shot('embedded-live-preview')

    run('await app.workspace.revealLeaf(view().leaf);return true')
    await click('Play walkthrough')
    await until('view().viewer.step===1')
    expect(run<number>('return view().viewer.scene().graph.nodes.length')).toBe(1)
    const source = run<string>('return await app.vault.read(app.vault.getAbstractFileByPath(path))')
    await openMenu()
    shot('export-menu')
    await press('menuItem("Export whole canvas as PNG")')
    await until('view().lastExport?.extension==="png"&&!view().exportController')
    const png = run<string>('return view().lastExport.path')
    expect(
      run<boolean>(`
      const result=parsed(await call('canvas_export',{path,output:${JSON.stringify(`${DIR}/sample-agent.png`)},format:'png'}))
      const a=new Uint8Array(await app.vault.readBinary(app.vault.getAbstractFileByPath(${JSON.stringify(png)}))),b=new Uint8Array(await app.vault.readBinary(app.vault.getAbstractFileByPath(result.path)))
      return result.visible.length===2&&a.length===b.length&&a.every((v,i)=>v===b[i])
    `)
    ).toBe(true)
    const pdf = await exportWhole('pdf')
    expect(
      run<string>(
        `return new TextDecoder().decode((await app.vault.readBinary(app.vault.getAbstractFileByPath(${JSON.stringify(pdf)}))).slice(0,8))`
      )
    ).toBe('%PDF-1.4')
    expect(run<string>('return await app.vault.read(app.vault.getAbstractFileByPath(path))')).toBe(
      source
    )
    run(
      `const leaf=app.workspace.getLeaf('tab');await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(png)}));await app.workspace.revealLeaf(leaf);return true`
    )
    await until(`app.workspace.getActiveFile()?.path===${JSON.stringify(png)}`)
    await new Promise((r) => setTimeout(r, 700))
    await until('!document.querySelector(".notice")')
    shot('exported-image')
  }, 180_000)
})
