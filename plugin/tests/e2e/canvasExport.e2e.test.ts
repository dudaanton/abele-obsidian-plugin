import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { screenshot, tap, typeText } from './helpers/phone'
import { withNativeInput } from './helpers/nativeInput'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const DIR = 'Sample canvas export'
const SHOTS = shotDir('canvas-export')
const PRELUDE = `
  const path=${JSON.stringify(`${DIR}/sample.canvas`)}
  const wait=ms=>new Promise(r=>setTimeout(r,ms))
  const view=()=>app.workspace.getLeavesOfType('abele-canvas').find(l=>l.view.file?.path===path)?.view
  const menuItem=label=>[...document.querySelectorAll('.menu-item')].find(el=>el.textContent.trim()===label)
  const tools=Object.fromEntries(window.__abeleTest.createAgentTools().map(t=>[t.name,t]))
  const scope=new window.__abeleTest.ScopeResolver();scope.setFullVaultAccess(true)
  const ctx={scope,interactive:true}
`
const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async()=>{${PRELUDE} return JSON.stringify(await(async()=>{${body}})())})()`,
    120_000
  )
const until = async (expression: string) => {
  await expect.poll(() => run<boolean>(`return !!(${expression})`), { timeout: 20_000 }).toBe(true)
}
// Leave the pointer off new notices: hovering them pauses dismissal and covers the next export action.
const press = async (expression: string) => {
  const geometry = `const el=${expression};if(!el)return null;const r=el.getBoundingClientRect();const x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);if(!r.width||!r.height||x<0||y<0||x>=innerWidth||y>=innerHeight||!el.contains(document.elementFromPoint(x,y)))return null;return[x,y]`
  await expect.poll(() => run<number[] | null>(geometry), { timeout: 15_000 }).not.toBeNull()
  const [x, y] = run<number[]>(geometry)
  if (onPhone()) tap(x, y)
  else
    await withNativeInput(() =>
      run(`
    const cdp=require('@electron/remote').getCurrentWebContents().debugger,owned=!cdp.isAttached();if(owned)cdp.attach('1.3')
    try{await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:${x},y:${y},button:'left',buttons:1,clickCount:1});await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:${x},y:${y},button:'left',buttons:0,clickCount:1});await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:innerHeight-1,buttons:0})}finally{if(owned)cdp.detach()}return true
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
const openMenu = () =>
  press('view().containerEl.querySelector(\'[aria-label="Export diagram picture"]\')')
const chooseExport = async (format: string) => {
  await openMenu()
  await press(`menuItem(${JSON.stringify(`Export whole canvas as ${format.toUpperCase()}`)})`)
  await until(`view().lastExport?.extension===${JSON.stringify(format)}&&!view().exportController`)
  return run<string>('return view().lastExport.path')
}

describe.skipIf(!available)('whole canvas export through real pointer and touch input', () => {
  beforeAll(() => {
    run(`
      if(app.vault.getAbstractFileByPath(${JSON.stringify(DIR)}))throw Error('Synthetic folder already exists')
      window.__canvasExport={layout:app.workspace.getLayout(),folder:app.vault.getConfig('attachmentFolderPath'),preference:window.__abeleTest.AbeleConfig.getInstance().canvasViewer}
      window.__canvasExportScriptRuns=0
      window.__abeleTest.AbeleConfig.getInstance().canvasViewer=true
      await app.vault.createFolder(${JSON.stringify(DIR)});window.__canvasExport.owned=true
      app.vault.setConfig('attachmentFolderPath',${JSON.stringify(DIR)})
      const note=await app.vault.create(${JSON.stringify(`${DIR}/sample-note.md`)},${JSON.stringify('# Linked note\nReadable note — 日本語.\n')})
      await app.vault.create(${JSON.stringify(`${DIR}/sample-target.md`)},${JSON.stringify('Export snapshots belong below.\n')})
      const image=document.createElement('canvas');image.width=120;image.height=60
      const c=image.getContext('2d');c.fillStyle=getComputedStyle(document.body).getPropertyValue('--interactive-accent');c.fillRect(0,0,120,60);c.fillStyle=getComputedStyle(document.body).getPropertyValue('--text-on-accent');c.font='16px sans-serif';c.fillText('Attachment',10,35)
      const blob=await new Promise(r=>image.toBlob(r,'image/png'))
      const picture=await app.vault.createBinary(${JSON.stringify(`${DIR}/sample-image.png`)},await blob.arrayBuffer())
      const drawing=await app.vault.create(${JSON.stringify(`${DIR}/sample-sketch.svg`)},'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80" viewBox="0 0 160 80"><path d="M10 50 Q40 10 80 50 T150 50" fill="none" stroke="currentColor" stroke-width="4"/></svg>')
      const graph={nodes:[
        {id:'near',type:'text',text:'Near card — café',x:0,y:0,width:280,height:160,styleAttributes:{shape:'pill'}},
        {id:'note',type:'file',file:note.path,x:430,y:0,width:280,height:180},
        {id:'image',type:'file',file:picture.path,x:800,y:0,width:180,height:110},
        {id:'drawing',type:'file',file:drawing.path,x:1100,y:0,width:200,height:140},
        {id:'far',type:'text',text:${JSON.stringify('Distant result\n<script>window.__canvasExportScriptRuns++</script>')},x:1500,y:0,width:360,height:180,styleAttributes:{shape:'rectangle'}},
      ],edges:[{id:'a',fromNode:'near',toNode:'note'},{id:'b',fromNode:'note',toNode:'image'},{id:'c',fromNode:'image',toNode:'drawing'},{id:'d',fromNode:'drawing',toNode:'far'}],abele:{steps:[{id:'first',reveal:['near'],focus:'near',say:'Only the first card is visible.'}]}}
      const file=await app.vault.create(path,JSON.stringify(graph));window.__canvasExport.source=await app.vault.read(file)
      // Start in Abele directly: native Canvas normalizes image geometry on first open.
      const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'abele-canvas',state:{file:file.path},active:true});await app.workspace.revealLeaf(leaf);return true
    `)
  }, 120_000)
  afterAll(() => {
    run(`
      document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
      const state=window.__canvasExport,leaves=[];app.workspace.iterateAllLeaves(l=>{if(l.view.file?.path.startsWith(${JSON.stringify(DIR + '/')}))leaves.push(l)});for(const leaf of leaves)leaf.detach()
      if(state?.owned){const dir=app.vault.getAbstractFileByPath(${JSON.stringify(DIR)});if(dir)await app.vault.delete(dir,true)}
      if(state){app.vault.setConfig('attachmentFolderPath',state.folder);window.__abeleTest.AbeleConfig.getInstance().canvasViewer=state.preference;await app.workspace.changeLayout(state.layout)}
      delete window.__canvasExport;delete window.__canvasExportScriptRuns;return true
    `)
  }, 120_000)
  it('exports every card and local attachment while viewing only the first walkthrough card', async () => {
    await until('view()?.editor')
    expect(run<string>('return await app.vault.read(app.vault.getAbstractFileByPath(path))')).toBe(
      run<string>('return window.__canvasExport.source')
    )
    shot('mixed-canvas')
    await press('view().contentEl.querySelector(\'[aria-label="Play walkthrough"]\')')
    await until('view().viewer.step===1')
    expect(run<string[]>('return view().viewer.scene().graph.nodes.map(n=>n.id)')).toEqual(['near'])
    shot('first-card')
    await openMenu()
    shot('export-menu')
    await press('menuItem("Export whole canvas as PNG")')
    await until('view().lastExport?.extension==="png"&&!view().exportController')
    const png = run<string>('return view().lastExport.path')
    const agent = run<{
      visible: string[]
      warnings: { code: string }[]
      revision: string
      same: boolean
    }>(`
      const data=JSON.parse((await tools.canvas_export.execute('sample-export',{path,output:${JSON.stringify(`${DIR}/sample-agent.png`)},format:'png'},undefined,ctx)).content[0].text)
      const human=await app.vault.readBinary(app.vault.getAbstractFileByPath(${JSON.stringify(png)})),automatic=await app.vault.readBinary(app.vault.getAbstractFileByPath(data.path))
      return {...data,same:human.byteLength===automatic.byteLength&&new Uint8Array(human).every((v,i)=>v===new Uint8Array(automatic)[i])}
    `)
    expect(agent.visible).toEqual(['near', 'note', 'image', 'drawing', 'far'])
    expect(agent.warnings.filter((w) => /unavailable|missing|scope/.test(w.code))).toEqual([])
    expect(agent.same).toBe(true)
    run(
      `const leaf=app.workspace.getLeaf('tab');await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(png)}));await app.workspace.revealLeaf(leaf);return true`
    )
    await until(`app.workspace.getActiveFile()?.path===${JSON.stringify(png)}`)
    await new Promise((r) => setTimeout(r, 700))
    shot('whole-png')
    run('await app.workspace.revealLeaf(view().leaf);return true')
  }, 120_000)
  it('inserts a PNG snapshot using the native note picker and preserves the original note', async () => {
    await openMenu()
    await press('menuItem("Insert exported file into note…")')
    await press('document.querySelector(".prompt-input")')
    if (onPhone()) {
      await new Promise((r) => setTimeout(r, 500))
      typeText('sample-target')
    } else
      await withNativeInput(() =>
        run(
          `const cdp=require('@electron/remote').getCurrentWebContents().debugger,owned=!cdp.isAttached();if(owned)cdp.attach('1.3');try{await cdp.sendCommand('Input.insertText',{text:'sample-target'})}finally{if(owned)cdp.detach()}return true`
        )
      )
    await press(
      '[...document.querySelectorAll(".suggestion-item")].find(el=>el.textContent.includes("sample-target.md"))'
    )
    await until(
      `(await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(`${DIR}/sample-target.md`)}))).includes('![[')`
    )
    expect(
      run<string>(
        `return await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(`${DIR}/sample-target.md`)}))`
      )
    ).toMatch(/^Export snapshots belong below\.\n\n!\[\[/)
  }, 120_000)
  it('exports a script-free SVG and opens a readable one-page PDF without changing source bytes', async () => {
    const svg = await chooseExport('svg')
    expect(
      run<boolean>(
        `const text=await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(svg)}));return text.includes('data:image/png;base64,')&&!text.includes('<script')`
      )
    ).toBe(true)
    const pdf = await chooseExport('pdf')
    const result = run<{
      header: string
      unchanged: boolean
      scripts: number
      source: string
      original: string
    }>(`
      const bytes=await app.vault.readBinary(app.vault.getAbstractFileByPath(${JSON.stringify(pdf)}))
      const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'abele-book',state:{file:${JSON.stringify(pdf)}},active:true});await app.workspace.revealLeaf(leaf)
      window.__canvasExport.pdfView=leaf.view
      return{header:new TextDecoder().decode(bytes.slice(0,8)),unchanged:window.__canvasExport.source===await app.vault.read(app.vault.getAbstractFileByPath(path)),scripts:window.__canvasExportScriptRuns,source:await app.vault.read(app.vault.getAbstractFileByPath(path)),original:window.__canvasExport.source}
    `)
    expect(result.source).toBe(result.original)
    expect({ header: result.header, unchanged: result.unchanged, scripts: result.scripts }).toEqual(
      { header: '%PDF-1.4', unchanged: true, scripts: 0 }
    )
    await until('window.__canvasExport.pdfView.model?.status==="ready"')
    await until(
      'window.__canvasExport.pdfView.engine?.renderer?.getContents().some(c=>c.doc?.querySelector("#canvas img"))'
    )
    shot('whole-pdf')
  }, 120_000)
})
