import { afterAll, describe, expect, it } from 'vitest'
import {
  activeVaultName,
  isObsidianRunning,
  reloadApp,
  restoreDesktopWindow,
  vaultCli,
} from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'
import {
  financeChartResizeFixture,
  financeChartResizeFolder,
} from './helpers/financeChartResizeFixture'

targets('desktop')
const available = isObsidianRunning()
const shots = shotDir('finance-chart-resize')
afterAll(async () => {
  if (available) await restoreDesktopWindow()
})

describe.skipIf(!available)('finance chart resizing', () => {
  it.each([false, true])('survives sidebar toggles on mobile=%s', async (mobile) => {
    await reloadApp(`app.emulateMobile(${mobile})`)
    const cli = vaultCli(activeVaultName())
    const seed = JSON.parse(
      cli.evalAwait<string>(`(async () => {
      const data = (await app.plugins.plugins.abele.loadData()) || {}
      const pinned = window.__abeleTest?.AbeleConfig.getInstance().pinnedCurrencies ?? data.pinnedCurrencies
      const currency = String(pinned || 'EUR').split(',')[0].trim().toUpperCase() || 'EUR'
      const d = new Date()
      const today = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
      return JSON.stringify({ error: '', currency, today })
    })().catch(error => JSON.stringify({ error: String(error) }))`)
    ) as { error: string; currency: string; today: string }
    expect(seed.error).toBe('')
    const files = financeChartResizeFixture(seed.currency, seed.today)
    const result = JSON.parse(
      cli.evalAwait<string>(
        `(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
      const until = async (read, label) => {
        const deadline = Date.now() + 20000
        while (Date.now() < deadline) {
          if (read()) return
          await wait(100)
        }
        throw Error(label)
      }
      const ws = app.workspace
      const win = require('@electron/remote').getCurrentWindow()
      win.setContentSize(${mobile ? '390, 844' : '1280, 900'})
      const folder = ${JSON.stringify(financeChartResizeFolder)}
      const leftCollapsed = ws.leftSplit.collapsed
      const rightCollapsed = ws.rightSplit.collapsed
      let leaf
      let createdFolder = false
      try {
        await app.vault.createFolder(folder)
        createdFolder = true
        for (const [path, content] of Object.entries(${JSON.stringify(files)})) {
          await app.vault.create(folder + '/' + path, content)
        }
        // Phone drawers overlay the content; the chart must be in the content tab that
        // becomes visible again after they close. Desktop exercises the docked sidebar.
        leaf = ${mobile} ? ws.getLeaf('tab') : ws.getRightLeaf(true)
        await leaf.setViewState({ type: 'abele-finance-sidebar-view', active: true })
        if (${mobile}) {
          ws.leftSplit.collapse()
          ws.rightSplit.collapse()
        } else ws.rightSplit.expand()
        await ws.revealLeaf(leaf)
        const chart = () => leaf.view.containerEl.querySelector('.abele-finance-sidebar__pie-chart')
        await until(() => chart()?.querySelector('canvas'), 'Missing seeded finance chart in ' + ${JSON.stringify(seed.currency)})
        const widths = []
        const phoneLayouts = []
        let lastMeasurement = null
        const measure = () => {
          const el = chart()
          const canvas = el?.querySelector('canvas')
          const pane = leaf.view.containerEl
          return {
            container: el?.clientWidth ?? 0,
            css: canvas ? parseFloat(canvas.style.width) : 0,
            buffer: canvas ? canvas.width / devicePixelRatio : 0,
            visible: !!el && el.checkVisibility(),
            pane: pane.getBoundingClientRect().width,
            content: ws.rootSplit.containerEl.getBoundingClientRect().width,
            leftClosed: ws.leftSplit.collapsed,
            rightClosed: ws.rightSplit.collapsed,
          }
        }
        for (let i = 0; i < 3; i++) {
          ws.rightSplit.collapse()
          ws.leftSplit.expand()
          await wait(200)
          ws.leftSplit.collapse()
          ws.rightSplit.expand()
          if (${mobile}) {
            await wait(200)
            ws.rightSplit.collapse()
          }
          await ws.revealLeaf(leaf)
          await wait(500)
          try {
            await until(() => {
              const m = lastMeasurement = measure()
              return m.visible && m.container > 1 &&
                Math.abs(m.css - m.container) <= 1 &&
                Math.abs(m.buffer - m.container) <= 1 &&
                (!${mobile} || (m.leftClosed && m.rightClosed && Math.abs(m.pane - m.content) <= 1))
            }, 'Finance canvas did not reach its visible container size')
          } catch (error) {
            throw Error(String(error) + ' after toggle ' + i + ': ' + JSON.stringify(lastMeasurement))
          }
          const m = measure()
          // The intrinsic drawing buffer detects a stale chart even if CSS stretches it.
          widths.push([m.container, m.css, m.buffer])
          if (${mobile}) phoneLayouts.push(m)
        }
        chart().scrollIntoView({ block: 'center' })
        await wait(200)
        const shot = ${JSON.stringify(shots)} + '/finance-' + ${JSON.stringify(mobile ? 'phone' : 'desktop')} + '.png'
        const image = await win.webContents.capturePage()
        require('node:fs').writeFileSync(shot, image.toPNG())
        return { error: '', widths, phoneLayouts, shot }
      } finally {
        leaf?.detach()
        if (leftCollapsed) ws.leftSplit.collapse(); else ws.leftSplit.expand()
        if (rightCollapsed) ws.rightSplit.collapse(); else ws.rightSplit.expand()
        const dir = app.vault.getAbstractFileByPath(folder)
        if (createdFolder && dir) await app.vault.delete(dir, true)
      }
    })().then(result => JSON.stringify(result)).catch(error => JSON.stringify({ error: String(error), widths: [], shot: '' }))`,
        120_000
      )
    ) as {
      error: string
      widths: number[][]
      phoneLayouts: {
        leftClosed: boolean
        rightClosed: boolean
        visible: boolean
        pane: number
        content: number
      }[]
      shot: string
    }
    expect(result.error).toBe('')
    expect(result.widths).toHaveLength(3)
    for (const [container, css, buffer] of result.widths) {
      expect(container).toBeGreaterThan(1)
      expect(Math.abs(css - container)).toBeLessThanOrEqual(1)
      expect(Math.abs(buffer - container)).toBeLessThanOrEqual(1)
    }
    if (mobile) {
      expect(result.phoneLayouts).toHaveLength(3)
      for (const layout of result.phoneLayouts) {
        expect(layout.leftClosed && layout.rightClosed && layout.visible).toBe(true)
        expect(Math.abs(layout.pane - layout.content)).toBeLessThanOrEqual(1)
      }
    }
    expect(result.shot).toMatch(/\.png$/)
  })
})
