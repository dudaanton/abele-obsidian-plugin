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
let owned = false
const run = <T>(body: string): T =>
  evalAsync<T>(`(async()=>{
  const path=${JSON.stringify(PATH)},dir=${JSON.stringify(DIR)}
  const view=()=>app.workspace.getLeavesOfType('abele-canvas').find(l=>l.view.file?.path===path)?.view
  return JSON.stringify(await(async()=>{${body}})())
})()`)
const until = async (condition: string) => {
  await expect.poll(() => run(`return !!(${condition})`), { timeout: 15000 }).toBe(true)
}
const open = () => run(`await app.workspace.openLinkText(path,'','tab');return true`)
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

afterAll(async () => {
  if (!available || !owned) return
  run(`
    const leaves=[];app.workspace.iterateAllLeaves(l=>{if(l.view.file?.path.startsWith(dir+'/'))leaves.push(l)})
    for(const leaf of leaves){await leaf.view.editor?.flush();leaf.detach()}
    const folder=app.vault.getAbstractFileByPath(dir);if(folder)await app.vault.delete(folder,true)
    return true`)
  await reloadApp('app.emulateMobile(false)')
}, 120000)

describe.skipIf(!available)('note panels inside canvas cards', () => {
  it('persists choices and follows screen size, with controls that click or carry the card', async () => {
    owned = run<boolean>(`
      if(app.vault.getAbstractFileByPath(dir))throw Error('Synthetic folder already exists')
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
      run(`
        const {Menu}=require('obsidian'),menu=new Menu();view().onPaneMenu(menu,'more-options')
        menu.showAtPosition({x:40,y:80})
        const item=[...document.querySelectorAll('.menu-item')].find(i=>i.querySelector('.menu-item-title')?.textContent==='Notes show header and footer')
        if(!item)throw Error('Canvas panel menu entry missing');item.click();return true`)
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
      expect(
        run(
          'return !!app.workspace.activeLeaf.view.containerEl.querySelector(\'[data-abele-anchor="section:backlinks"]\')'
        )
      ).toBe(true)
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
