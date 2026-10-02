/** The explorer's real context menu keeps drawing providers distinct on desktop and mobile. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
} from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'

const available = isObsidianRunning() && hasTestApi()
const shots = shotDir('drawing-menu')

interface Report {
  error?: string
  titles: string[]
  sources: string[]
  created?: { extension: string; parent: string; drawing: boolean }
}

async function probe(otherProvider: boolean, mode: string): Promise<Report> {
  const result = await evalLong(`(async () => {
    const folderPath = 'sample-drawing-menu'
    const layout = app.workspace.getLayout()
    const wait = ms => new Promise(r => setTimeout(r, ms))
    const until = async fn => {
      for (let i = 0; i < 100; i++) { const value = fn(); if (value) return value; await wait(100) }
      throw new Error('Timed out waiting for the drawing menu')
    }
    const report = { titles: [], sources: [] }
    let created = false, other, observed, drawingLeaf
    const escape = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }))
    try {
      if (app.vault.getAbstractFileByPath(folderPath)) throw new Error('Fixture already exists')
      await app.vault.createFolder(folderPath)
      created = true
      if (${otherProvider}) other = app.workspace.on('file-menu', (menu, file) => {
        if (file.path === folderPath) menu.addItem(item => item.setTitle('New drawing').setIcon('pencil'))
      })
      observed = app.workspace.on('file-menu', (_menu, file, source) => {
        if (file.path === folderPath) report.sources.push(source)
      })
      const explorer = app.workspace.getLeavesOfType('file-explorer')[0]
      await app.workspace.revealLeaf(explorer)
      app.workspace.leftSplit.expand()
      const el = await until(() => [...explorer.view.containerEl.querySelectorAll('.nav-folder-title')].find(e => e.dataset.path === folderPath))
      el.scrollIntoView({ block: 'center' })
      await wait(300)
      const b = el.getBoundingClientRect()
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: b.left + 30, clientY: b.top + 10 }))
      await until(() => document.querySelector('.menu .menu-item-title'))
      report.titles = [...document.querySelectorAll('.menu .menu-item-title')].map(e => e.textContent.trim())
      // The mobile sheet enters after the menu DOM is populated.
      await wait(500)
      const remote = require('@electron/remote')
      const image = await remote.getCurrentWebContents().capturePage()
      require('fs').writeFileSync(${JSON.stringify(shots)} + '/' + ${JSON.stringify(`${mode}-${otherProvider ? 'coexist' : 'alone'}.png`)}, image.toPNG())
      const item = [...document.querySelectorAll('.menu .menu-item')].find(e => e.querySelector('.menu-item-title')?.textContent.trim() === 'New Abele drawing')
      if (!item) throw new Error('The Abele drawing item is missing')
      item.click()
      drawingLeaf = await until(() => app.workspace.getLeavesOfType('abele-drawing').find(l => l.view.file?.parent?.path === folderPath && l.view.session))
      const file = drawingLeaf.view.file
      report.created = { extension: file.extension, parent: file.parent.path, drawing: (await app.vault.read(file)).includes('data-abele-drawing') }
    } catch (e) { report.error = String(e?.stack || e) }
    finally {
      escape()
      if (other) app.workspace.offref(other)
      if (observed) app.workspace.offref(observed)
      drawingLeaf?.detach()
      const folder = app.vault.getAbstractFileByPath(folderPath)
      if (created && folder) await app.vault.delete(folder, true)
      await app.workspace.changeLayout(layout)
    }
    return report
  })()`)
  return JSON.parse(result) as Report
}

function check(report: Report, otherProvider: boolean): void {
  expect(report.error).toBeUndefined()
  expect(report.sources).toEqual(['file-explorer-context-menu'])
  expect(report.titles.filter((t) => t === 'New Abele drawing')).toHaveLength(1)
  expect(report.titles.filter((t) => t === 'New drawing')).toHaveLength(otherProvider ? 1 : 0)
  expect(report.created).toEqual({ extension: 'svg', parent: 'sample-drawing-menu', drawing: true })
}

describe.skipIf(!available)('folder drawing actions', () => {
  let size: number[] = []
  let mobile = false
  beforeAll(() => {
    mobile = evalJson<boolean>('app.isMobile')
    size = evalJson<number[]>(`require('@electron/remote').getCurrentWindow().getContentSize()`)
  })
  afterAll(async () => {
    evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]})`)
    if (evalJson<boolean>('app.isMobile') !== mobile)
      await reloadApp(`app.emulateMobile(${mobile})`)
  }, 120_000)

  it.each([false, true])(
    'offers one identifiable action with another provider: %s',
    async (other) => {
      check(await probe(other, 'desktop'), other)
    },
    90_000
  )

  it('still offers one action after re-enable', async () => {
    await reloadApp(
      `(async () => { await app.plugins.disablePlugin('abele'); await app.plugins.enablePlugin('abele') })()`
    )
    check(await probe(false, 'reenabled'), false)
  }, 120_000)

  it('distinguishes the actions in the mobile explorer menu', async () => {
    await reloadApp('app.emulateMobile(true)')
    evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390, 844)`)
    check(await probe(true, 'mobile'), true)
  }, 120_000)
})
