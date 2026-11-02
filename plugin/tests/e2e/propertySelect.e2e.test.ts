import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning, setFocusEmulation } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { onPhone } from './helpers/target'
import { shotDir } from './helpers/shots'

const SHOTS = shotDir('abele-property-select')
const DIR = 'Select sample e2e'
const NOTE = `${DIR}/Sample.md`
interface ProbeResult {
  shots: string[]
  overflow: string[]
  stored: unknown
  error?: string
}
const probe = async (phone: boolean): Promise<ProbeResult> =>
  JSON.parse(
    await evalLong(
      `(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async fn => {
    for (let i = 0; i < 100; i++) { const v = await fn(); if (v) return v; await wait(100) }
    throw new Error('Timed out: ' + String(fn))
  }
  const shots = [], overflow = []
  const shoot = async (name, target = null) => {
    await wait(250)
    const fs = require('fs'), remote = require('@electron/remote')
    const path = ${JSON.stringify(SHOTS)} + '/${phone ? 'phone' : 'desktop'}-' + name + '.png'
    fs.mkdirSync(${JSON.stringify(SHOTS)}, {recursive:true})
    const d = target?.ownerDocument || document
    const settingsWindow = d !== document
    const w = settingsWindow
      ? remote.BrowserWindow.getAllWindows().find(w => w.getTitle().startsWith('Settings - ' + app.vault.getName() + ' - '))
      : remote.getCurrentWindow()
    if (!w || w.isDestroyed() || !w.isVisible()) throw new Error(name + ': capture window not visible')
    if (settingsWindow && !w.getTitle().startsWith('Settings - ')) throw new Error('Wrong settings capture window')
    if (target) {
      target.scrollIntoView({block:'center'})
      await until(() => {
        const b = target.getBoundingClientRect(), style = d.defaultView.getComputedStyle(target)
        const x = Math.max(1, Math.min(d.defaultView.innerWidth - 1, b.left + b.width/2))
        const y = Math.max(1, Math.min(d.defaultView.innerHeight - 1, b.top + Math.min(b.height/2, 24)))
        const hit = d.elementFromPoint(x,y)
        return target.isConnected && b.width > 0 && b.height > 0 && b.left >= 0 && b.right <= d.defaultView.innerWidth + 1 && b.top >= 0 && b.top < d.defaultView.innerHeight && style.visibility === 'visible' && style.display !== 'none' && (target.contains(hit) || hit?.contains(target))
      })
      const title = await w.webContents.executeJavaScript('document.title')
      if (title !== d.title) throw new Error(name + ': captured document differs from visible target')
    }
    const image = await w.webContents.capturePage()
    fs.writeFileSync(path, image.toPNG()); shots.push(path)
    for (const el of d.querySelectorAll('.abele-property-select, .suggestion-container:has(.abele-property-select__choice), .abele-select-property')) {
      const b = el.getBoundingClientRect()
      if (b.width && (b.left < -1 || b.right > d.defaultView.innerWidth + 1)) overflow.push(name + ':' + el.className)
    }
  }
  const cfg = window.__abeleTest.AbeleConfig.getInstance()
  const saved = {select: JSON.parse(JSON.stringify(cfg.selectProperties || [])), widgets:cfg.propertyWidgets, shown:app.vault.getConfig('propertiesInDocument')}
  try {
    cfg.propertyWidgets = true
    cfg.selectProperties = [
      {key:'sample-stage',multiple:false,options:[{value:'Ready',icon:'check',color:'green',description:'Prepared for the next step'},{value:'Waiting',color:'orange',description:'Waiting for a sample review'}]},
      {key:'sample-labels',multiple:true,options:[{value:'Design',color:'blue'},{value:'Review',icon:'eye',color:'purple'}]}
    ]
    app.vault.setConfig('propertiesInDocument','visible')
    await cfg.saveSettings()
    if (!app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})) await app.vault.createFolder(${JSON.stringify(DIR)})
    const old = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})
    if (old) await app.vault.delete(old,true)
    const file = await app.vault.create(${JSON.stringify(NOTE)}, '---\\nsample-stage: Ready\\nsample-labels:\\n  - Design\\n  - Review\\n---\\n\\n# Sample selection\\n')
    await until(() => app.metadataCache.getFileCache(file)?.frontmatter)
    const leaf = app.workspace.getLeaf(false)
    await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'source',source:false},active:true})
    app.workspace.revealLeaf(leaf)
    const cell = key => leaf.view.containerEl.querySelector('.metadata-property[data-property-key="'+key+'"] .metadata-property-value')
    const stage = () => cell('sample-stage')
    await until(() => stage()?.querySelector('.abele-property-select__pill'))
    await shoot('chosen')
    stage().querySelector('.abele-property-select__pill').click()
    await until(() => document.querySelector('.abele-property-select__choice'))
    await shoot('list')
    const waiting = [...document.querySelectorAll('.abele-property-select__choice')].find(el => el.querySelector('.suggestion-title')?.textContent === 'Waiting')
    if (!waiting) throw new Error('Waiting option missing')
    waiting.click()
    await until(() => app.metadataCache.getFileCache(file)?.frontmatter?.['sample-stage'] === 'Waiting')
    stage().querySelector('input')?.blur()
    await app.fileManager.processFrontMatter(file, fm => {fm['sample-stage']='Unlisted sample'})
    await until(() => stage()?.querySelector('.is-unknown'))
    await shoot('unknown')
    cell('sample-labels').scrollIntoView({block:'center'})
    await until(() => cell('sample-labels')?.querySelectorAll('.abele-property-select__pill').length === 2)
    await shoot('multiple')
    // Keep a used option for the remove confirmation.
    await app.fileManager.processFrontMatter(file, fm => {fm['sample-stage']='Ready'})
    await until(() => app.metadataCache.getFileCache(file)?.frontmatter?.['sample-stage']==='Ready')
    app.setting.open(); app.setting.openTabById('abele')
    if (app.setting.activeTab?.id === 'abele') app.setting.activeTab.display()
    const root = await until(() => app.setting.activeTab?.containerEl.querySelector('.abele-settings'))
    const tab = await until(() => root.querySelector('.abele-tabs__tab[data-tab-id="other"]'))
    tab.click()
    const section = await until(() => root.querySelector('.abele-select-settings'))
    section.scrollIntoView({block:'start'}); await shoot('settings', section)
    section.querySelector('.abele-select-settings__property .clickable-icon').click()
    const d = root.ownerDocument
    const modal = await until(() => d.querySelector('.abele-select-property'))
    modal.querySelector('.abele-select-property__main').click()
    const editor = await until(() => modal.querySelector('.abele-select-property__editor'))
    await shoot('option', editor)
    modal.querySelector('.abele-select-property__row > .clickable-icon').click()
    const confirm = await until(() => d.querySelector('.abele-confirm__message'))
    await shoot('remove', confirm)
    return {shots,overflow,stored:app.metadataCache.getFileCache(file)?.frontmatter?.['sample-labels']}
  } catch(e) { return {shots,overflow,error:String(e.stack || e)} }
  finally {
    const d = app.setting?.activeTab?.containerEl?.ownerDocument || document
    const cleanup = async (label, fn) => {
      try { await fn() } catch(e) { throw new Error('Cleanup ' + label + ': ' + String(e)) }
    }
    for (const close of [...d.querySelectorAll('.modal.abele-modal .modal-close-button')].reverse()) { close.click(); await wait(100) }
    app.setting.activeTab?.hide?.()
    await wait(100)
    app.setting.close()
    cfg.selectProperties=saved.select; cfg.propertyWidgets=saved.widgets
    app.vault.setConfig('propertiesInDocument',saved.shown)
    await cleanup('save settings', () => cfg.saveSettings())
    for (const leaf of app.workspace.getLeavesOfType('markdown')) if (leaf.view.file?.path.startsWith(${JSON.stringify(DIR)})) leaf.detach()
    await wait(300)
    const file=app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}); if(file) await cleanup('delete sample', () => app.vault.delete(file,true))
    const folder=app.vault.getAbstractFileByPath(${JSON.stringify(DIR)}); if(folder) await cleanup('delete folder', () => app.vault.delete(folder,true))
  }
})()`,
      150_000
    )
  ) as ProbeResult

describe.skipIf(!isObsidianRunning() || !hasTestApi() || onPhone())(
  'select properties in the running app',
  () => {
    it('captures seven states on desktop and a 390×844 phone, with plain stored values', async () => {
      setFocusEmulation(true)
      try {
        for (const phone of [false, true]) {
          const result = phone
            ? await withEmulatedPhone(async () => {
                setFocusEmulation(true)
                return probe(true)
              })
            : await probe(false)
          expect(result.error).toBeUndefined()
          expect(result.shots).toHaveLength(7)
          expect(result.overflow).toEqual([])
          expect(result.stored).toEqual(['Design', 'Review'])
          console.log('Property select screenshots:', result.shots)
        }
      } finally {
        setFocusEmulation(false)
      }
    }, 420_000)
  }
)
