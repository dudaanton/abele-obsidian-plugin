import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sampleDocx } from '../fixtures/docx/sampleDocx'
import { evalAsync } from './helpers/githubLive'
import { evalJson, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const PATH = 'sample-word-e2e.docx'
const bytes = Buffer.from(sampleDocx()).toString('base64')
const available = isObsidianRunning() && hasTestApi()
const SHOTS = shotDir('abele-word')

describe.skipIf(!available)('Word document view', () => {
  let sidebars: [boolean, boolean] = [true, true]
  let size: [number, number] = [0, 0]
  beforeAll(() => {
    if (!onPhone()) {
      sidebars = evalJson('[app.workspace.leftSplit.collapsed,app.workspace.rightSplit.collapsed]')
      size = evalJson("require('@electron/remote').getCurrentWindow().getContentSize()")
      evalRaw('app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse()')
    }
    evalAsync(`(async () => {
      const data = Uint8Array.from(atob(${JSON.stringify(bytes)}), c => c.charCodeAt(0))
      const old = app.vault.getAbstractFileByPath(${JSON.stringify(PATH)})
      if (old) await app.vault.delete(old)
      await app.vault.createBinary(${JSON.stringify(PATH)}, data.buffer)
      return true
    })()`)
  })
  afterAll(async () => {
    if (!onPhone()) {
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]},${size[1]})`
      )
      await reloadApp('app.emulateMobile(false)')
    }
    evalAsync(`(async () => {
      for (const leaf of app.workspace.getLeavesOfType('abele-word')) if (leaf.view.file?.path === ${JSON.stringify(PATH)}) leaf.detach()
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(PATH)})
      if (file) await app.vault.delete(file)
      ${onPhone() ? '' : `if (!${sidebars[0]}) app.workspace.leftSplit.expand(); if (!${sidebars[1]}) app.workspace.rightSplit.expand();`}
      return true
    })()`)
  }, 120000)
  const probe = () =>
    evalAsync<{
      text: string
      safe: boolean
      over: boolean
      edit: boolean
      shot: string
    }>(`(async () => {
    const leaf = app.workspace.getLeaf('tab')
    await leaf.setViewState({type:'abele-word',state:{file:${JSON.stringify(PATH)}},active:true})
    await app.workspace.revealLeaf(leaf)
    const until = async fn => { for (let i=0;i<150;i++) { if(fn()) return; await new Promise(r => setTimeout(r,100)) } throw Error('Word preview did not open') }
    await until(() => leaf.view.contentEl.querySelector('iframe')?.contentDocument?.querySelector('section.docx'))
    const frame = leaf.view.contentEl.querySelector('iframe')
    const dom = frame.contentDocument
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    if (frame.getBoundingClientRect().height < 100) throw Error('Word preview has no visible height')
    const root = leaf.view.contentEl
    const edge = root.getBoundingClientRect()
    const over = [...root.querySelectorAll('.abele-word-toolbar button,.abele-word-toolbar input')].some(el => el.getBoundingClientRect().right > edge.right+1)
    const path = ${JSON.stringify(SHOTS)} + '/word-' + (app.isMobile ? 'phone' : 'desktop') + '.png'
    if (window.__e2eHost) await window.__e2eHost.shot(path)
    else { const fs = require('fs'); fs.mkdirSync(${JSON.stringify(SHOTS)},{recursive:true}); const image = await require('@electron/remote').getCurrentWindow().webContents.capturePage(); fs.writeFileSync(path,image.toPNG()) }
    return { text:dom.body.textContent, safe:!dom.querySelector('script,iframe') && frame.getAttribute('sandbox') === 'allow-same-origin', over, edit:!!root.querySelector('.abele-word-edit'),shot:path }
  })()`)
  it('renders a Word package without executable document content', () => {
    const result = probe()
    expect(result.text).toContain('Sample report')
    expect(result.text).toContain('Cell sample')
    expect(result.safe).toBe(true)
    expect(result.over).toBe(false)
    console.info(result.shot)
  })
  it('fits a phone screen and offers no hand-editing controls', async () => {
    if (!onPhone()) {
      evalRaw("require('@electron/remote').getCurrentWindow().setContentSize(390,844)")
      await reloadApp('app.emulateMobile(true)')
    }
    const result = probe()
    expect(result.over).toBe(false)
    expect(result.edit).toBe(false)
    expect(result.text).toContain('Sample report')
    console.info(result.shot)
  }, 120000)
})
