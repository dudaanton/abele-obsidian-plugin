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
import { withNativeInput } from './helpers/nativeInput'
import { randomUUID } from 'node:crypto'

const available = isObsidianRunning() && hasTestApi()
const shots = shotDir('drawing-menu')

interface Report {
  error?: string
  folder: string
  titles: string[]
  sources: string[]
  nativeContextMenu?: boolean
  created?: { extension: string; parent: string; drawing: boolean }
}

async function probe(otherProvider: boolean, mode: string): Promise<Report> {
  const result = await withNativeInput(() =>
    evalLong(`(async () => {
    const folderPath = ${JSON.stringify(`sample-drawing-menu-${randomUUID()}`)}
    const layout = app.workspace.getLayout()
    const nativeMenus = app.vault.getConfig('nativeMenus')
    const wait = ms => new Promise(r => setTimeout(r, ms))
    const until = async fn => {
      for (let i = 0; i < 100; i++) { const value = fn(); if (value) return value; await wait(100) }
      throw new Error('Timed out waiting for the drawing menu')
    }
    const report = { folder: folderPath, titles: [], sources: [] }
    let created = false, other, observed, drawingLeaf
    const escape = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }))
    try {
      escape()
      app.vault.setConfig('nativeMenus', false)
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
      app.workspace.rightSplit.collapse()
      app.workspace.leftSplit.expand()
      const el = await until(() => [...explorer.view.containerEl.querySelectorAll('.nav-folder-title')].find(e => e.dataset.path === folderPath))
      el.scrollIntoView({ block: 'center' })
      await wait(300)
      let last='',stable=0,point
      if(app.isMobile)await until(()=>{
        const b=el.getBoundingClientRect(),x=Math.round(b.left+b.width*.65),y=Math.round(b.top+b.height/2),hit=document.elementFromPoint(x,y)
        const signature=JSON.stringify([b.x,b.y,b.width,b.height]);point={x,y,box:b.toJSON(),hit:hit?.outerHTML}
        stable=b.width>0&&x>=0&&y>=0&&x<innerWidth&&y<innerHeight&&el.contains(hit)&&signature===last?stable+1:0;last=signature
        return stable>=5
      })
      const b = el.getBoundingClientRect()
      if(app.isMobile){
        const {x,y}=point
        const cdp=require('@electron/remote').getCurrentWebContents().debugger,owned=!cdp.isAttached();if(owned)cdp.attach('1.3')
        // Desktop mobile emulation does not synthesize the phone OS's long-press
        // context-menu event. Use Chromium's real context-menu gesture; Obsidian
        // still renders its mobile sheet, and the trusted explorer event is witnessed.
        el.addEventListener('contextmenu',event=>{report.nativeContextMenu=event.isTrusted},{once:true,capture:true})
        try{
          await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'right',buttons:2,clickCount:1})
          await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'right',buttons:0,clickCount:1})
        }finally{if(owned)cdp.detach()}
      }else el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: b.left + 30, clientY: b.top + 10 }))
      await until(() => report.sources.length === 1 && [...document.querySelectorAll('.menu-item-title')].some(e => e.textContent.trim() === 'New Abele drawing'))
      report.titles = [...document.querySelectorAll('.menu-item-title')].map(e => e.textContent.trim())
      // The mobile sheet enters after the menu DOM is populated.
      await wait(500)
      const remote = require('@electron/remote')
      const image = await remote.getCurrentWebContents().capturePage()
      require('fs').writeFileSync(${JSON.stringify(shots)} + '/' + ${JSON.stringify(`${mode}-${otherProvider ? 'coexist' : 'alone'}.png`)}, image.toPNG())
      const item = [...document.querySelectorAll('.menu-item-title')].find(e => e.textContent.trim() === 'New Abele drawing')
      if (!item) throw new Error('The Abele drawing item is missing: '+JSON.stringify({titles:report.titles,live:[...document.querySelectorAll('.menu-item-title')].map(el=>el.outerHTML)}))
      item.click()
      drawingLeaf = await until(() => app.workspace.getLeavesOfType('abele-drawing').find(l => l.view.file?.parent?.path === folderPath && l.view.session))
      const file = drawingLeaf.view.file
      report.created = { extension: file.extension, parent: file.parent.path, drawing: (await app.vault.read(file)).includes('data-abele-drawing') }
    } catch (e) { report.error = String(e?.stack || e) }
    finally {
      escape()
      app.vault.setConfig('nativeMenus', nativeMenus)
      if (other) app.workspace.offref(other)
      if (observed) app.workspace.offref(observed)
      drawingLeaf?.detach()
      const folder = app.vault.getAbstractFileByPath(folderPath)
      if (created && folder) await app.vault.delete(folder, true)
      await app.workspace.changeLayout(layout)
    }
    return report
  })()`)
  )
  const report = JSON.parse(result) as Report
  console.info('Drawing menu probe:', report)
  return report
}

function check(report: Report, otherProvider: boolean): void {
  expect(report.error).toBeUndefined()
  expect(report.sources).toEqual(['file-explorer-context-menu'])
  expect(report.titles.filter((t) => t === 'New Abele drawing')).toHaveLength(1)
  expect(report.titles.filter((t) => t === 'New drawing')).toHaveLength(otherProvider ? 1 : 0)
  expect(report.created).toEqual({ extension: 'svg', parent: report.folder, drawing: true })
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
    const report = await probe(true, 'mobile')
    check(report, true)
    expect(report.nativeContextMenu).toBe(true)
  }, 120_000)
})
