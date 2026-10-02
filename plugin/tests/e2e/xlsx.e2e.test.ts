import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sampleXlsx } from '../fixtures/xlsx/sampleXlsx'
import { evalAsync } from './helpers/githubLive'
import { evalJson, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const PATH = 'sample-workbook-e2e.xlsx'
const bytes = Buffer.from(sampleXlsx()).toString('base64')
const SHOTS = shotDir('abele-workbook')
const available = isObsidianRunning() && hasTestApi()
describe.skipIf(!available)('workbook view', () => {
  let size: [number, number] = [0, 0]
  let sidebars: [boolean, boolean] = [true, true]
  beforeAll(() => {
    if (!onPhone()) {
      size = evalJson("require('@electron/remote').getCurrentWindow().getContentSize()")
      sidebars = evalJson('[app.workspace.leftSplit.collapsed,app.workspace.rightSplit.collapsed]')
      evalRaw('app.workspace.leftSplit.collapse();app.workspace.rightSplit.collapse()')
    }
    evalAsync(
      `(async()=>{const path=${JSON.stringify(PATH)};const old=app.vault.getAbstractFileByPath(path);if(old) await app.vault.delete(old);await app.vault.createBinary(path,Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0)).buffer);return true})()`
    )
  })
  afterAll(async () => {
    if (!onPhone()) {
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]},${size[1]})`
      )
      await reloadApp('app.emulateMobile(false)')
    }
    evalAsync(
      `(async()=>{for(const l of app.workspace.getLeavesOfType('abele-workbook')) if(l.view.file?.path===${JSON.stringify(PATH)})l.detach();const f=app.vault.getAbstractFileByPath(${JSON.stringify(PATH)});if(f)await app.vault.delete(f);${onPhone() ? '' : `if(!${sidebars[0]})app.workspace.leftSplit.expand();if(!${sidebars[1]})app.workspace.rightSplit.expand();`}return true})()`
    )
  }, 120000)
  const probe = () =>
    evalAsync<{
      text: string
      over: boolean
      cells: number
      formula: string
      editing: boolean
      shot: string
    }>(`(async()=>{
    const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'abele-workbook',state:{file:${JSON.stringify(PATH)}},active:true});await app.workspace.revealLeaf(leaf)
    const root=leaf.view.contentEl;for(let i=0;i<150&&!root.querySelector('[data-cell="C1"]');i++)await new Promise(r=>setTimeout(r,100));if(!root.querySelector('[data-cell="C1"]'))throw Error('Workbook grid did not load')
    root.querySelector('[data-cell="C1"]').click();await new Promise(r=>setTimeout(r,100))
    const edge=root.getBoundingClientRect();const over=[...root.querySelectorAll('.abele-workbook-bar input,.abele-workbook-bar select,.abele-workbook-bar button')].some(el=>el.getBoundingClientRect().right>edge.right+1)
    const path=${JSON.stringify(SHOTS)}+'/workbook-'+(app.isMobile?'phone':'desktop')+'.png'
    if(window.__e2eHost)await window.__e2eHost.shot(path);else{const fs=require('fs');fs.mkdirSync(${JSON.stringify(SHOTS)},{recursive:true});fs.writeFileSync(path,(await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG())}
    return {text:root.textContent,over,cells:root.querySelectorAll('[data-cell]').length,formula:root.querySelector('.abele-workbook-formula').textContent,editing:!!root.querySelector('.abele-workbook-editor'),shot:path}
  })()`)
  it('opens cached values, merged cells, tabs and formulas', () => {
    const result = probe()
    expect(result.text).toContain('Sample heading')
    expect(result.formula).toContain('SUM(B1:B2)')
    expect(result.over).toBe(false)
    expect(result.cells).toBeLessThan(100)
    console.info(result.shot)
  })
  it('fits the phone layout and offers no hand editing', async () => {
    if (!onPhone()) {
      evalRaw("require('@electron/remote').getCurrentWindow().setContentSize(390,844)")
      await reloadApp('app.emulateMobile(true)')
    }
    const result = probe()
    expect(result.over).toBe(false)
    expect(result.editing).toBe(false)
    expect(result.text).toContain('Sample heading')
    console.info(result.shot)
  }, 120000)
})
