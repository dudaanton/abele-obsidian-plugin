import { afterAll, describe, expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { enterPhone, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { withNativeInput } from './helpers/nativeInput'

targets('desktop')
const available = isObsidianRunning() && hasTestApi()
const DIR = 'Sample card panels'
const PATH = `${DIR}/sample.canvas`
const SHOTS = shotDir('canvas-note-panels')
const run = <T>(body: string): T =>
  evalAsync<T>(`(async()=>{
  const path=${JSON.stringify(PATH)},dir=${JSON.stringify(DIR)}
  const view=()=>app.workspace.getLeavesOfType('abele-canvas').find(l=>l.view.file?.path===path)?.view
  return JSON.stringify((await(async()=>{${body}})()) ?? null)
})()`)
const until = async (condition: string) => {
  await expect.poll(() => run(`return !!(${condition})`), { timeout: 15000 }).toBe(true)
}
const NOTE_SECTION_DIAGNOSTICS = `
  const leaf=app.workspace.activeLeaf,v=leaf?.view,root=v?.containerEl
  return {
    type:v?.getViewType?.()??null,
    file:v?.file?.path??null,
    state:v?.getState?.()??null,
    anchors:root?[...root.querySelectorAll('[data-abele-anchor]')].map(el=>el.getAttribute('data-abele-anchor')):[],
    footerRoot:!!root?.querySelector('.abele-footer-widget-container,.abele-footer-view')
  }`
const waitForNoteSection = async () => {
  try {
    await until(
      `app.workspace.activeLeaf?.view.file?.path===dir+'/Sample note.md' && app.workspace.activeLeaf.view.containerEl.querySelector('[data-abele-anchor="section:backlinks"]')`
    )
  } catch (error) {
    const seen = run(NOTE_SECTION_DIAGNOSTICS)
    throw new Error(`Note footer section did not appear: ${JSON.stringify(seen)}`, { cause: error })
  }
}
const open = () => run(`await app.workspace.openLinkText(path,'','tab');return true`)
const PANEL_MENU = `
  const more=view().containerEl.querySelector('.view-action[aria-label="More options"]')
  if(!more)throw Error('Canvas pane menu button missing');more.click()
  const item=[...document.querySelectorAll('.menu-item')].find(i=>i.querySelector('.menu-item-title')?.textContent==='Notes show header and footer')
  if(!item)throw Error('Canvas panel menu entry missing');item.click();return true`
const shot = (name: string) =>
  run(`
  const wc=require('@electron/remote').getCurrentWebContents()
  require('fs').writeFileSync(${JSON.stringify(`${SHOTS}/`)}+${JSON.stringify(name)}+'.png',(await wc.capturePage()).toPNG())
  return true`)
const press = (selector: string, dx = 0) =>
  withNativeInput(() =>
    run(`
  const el=view().contentEl.querySelector(${JSON.stringify(selector)}),box=el.getBoundingClientRect()
  const x=box.x+box.width/2,y=box.y+box.height/2
  const cdp=require('@electron/remote').getCurrentWebContents().debugger,owned=!cdp.isAttached()
  if(owned)cdp.attach('1.3')
  try {
    await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,x,y,clickCount:1})
    for(let i=1;i<=6;i++) await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:x+${dx}*i/6,y})
    await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,x:x+${dx},y,clickCount:1})
  } finally {if(owned)cdp.detach()}
  return true`)
  )

const CLEANUP = `
    const errors=[]
    const leaves=[];app.workspace.iterateAllLeaves(l=>{if(l.view.file?.path.startsWith(dir+'/'))leaves.push(l)})
    for(const leaf of leaves){
      try {await leaf.view.editor?.flush?.()} catch(error) {errors.push(error)}
      finally {try {leaf.detach()} catch(error) {errors.push(error)}}
    }
    const folder=app.vault.getAbstractFileByPath(dir);if(folder)await app.vault.delete(folder,true)
    if(errors.length)throw new AggregateError(errors,'Synthetic canvas cleanup failed')
    return true`

afterAll(async () => {
  if (!available) return
  try {
    run(CLEANUP)
  } finally {
    await reloadApp('app.emulateMobile(false)')
  }
}, 120000)

describe.skipIf(!available)('note panels inside canvas cards', () => {
  it('persists choices and follows screen size, with controls that click or carry the card', async () => {
    run(CLEANUP)
    run(`
      await app.vault.createFolder(dir);return true`)
    run(`
      await app.vault.create(dir+'/Sample note.md','Sample text\\n\\n'+Array.from({length:20},()=> 'More sample words.').join('\\n\\n'))
      await app.vault.create(dir+'/Sample linked.md','[[Sample note]]')
      await app.vault.create(path,JSON.stringify({nodes:[{id:'sample',type:'file',file:dir+'/Sample note.md',x:0,y:0,width:340,height:500}],edges:[]}))
      return true`)
    for (const phone of [false, true]) {
      if (phone) await enterPhone(390, 844)
      open()
      await until('view()?.editor && view().viewer.graph.nodes.length===1')
      run(`view().viewer.setCamera({x:-10,y:-10,zoom:1});return true`)
      // Use the actual pane-menu handlers, including their persistence path.
      run(PANEL_MENU)
      await until("view().contentEl.querySelector('.abele-canvas-card_panels')")
      shot(phone ? 'phone-full-long' : 'desktop-full-long')
      run(`view().editor.controls.setPanels('sample',false);return true`)
      await until("!view().contentEl.querySelector('.abele-canvas-card_panels')")
      run(`view().editor.controls.setPanels('sample',true);return true`)
      run(`view().viewer.setCamera({x:-10,y:-10,zoom:0.5});return true`)
      await until("view().contentEl.querySelector('.abele-canvas-card-codes button')")
      shot(phone ? 'phone-codes' : 'desktop-codes')
      const x = run<number>('return view().viewer.graph.nodes[0].x')
      await press('.abele-canvas-card-codes button', 35)
      await until(`view().viewer.graph.nodes[0].x>${x}+20`)
      expect(run('return app.workspace.activeLeaf.view.file.path')).toBe(PATH)
      await press('.abele-canvas-card-codes button')
      await until("app.workspace.activeLeaf.view.file?.path===dir+'/Sample note.md'")
      await waitForNoteSection()
      open()
      run(`view().viewer.setCamera({x:-10,y:-10,zoom:0.1});return true`)
      await until(
        "!view().contentEl.querySelector('.abele-canvas-card_panels,.abele-canvas-card_codes')"
      )
      shot(phone ? 'phone-distant' : 'desktop-distant')
      run(`
        await view().editor.flush()
        const graph=JSON.parse(await app.vault.read(app.vault.getAbstractFileByPath(path)))
        if(graph.abele.notePanels!==true||graph.nodes[0].abele.panels!==true)throw Error('Panel choices not saved')
        view().editor.controls.setNotePanels(false);await view().editor.flush();return true`)
    }
  }, 180000)
})
