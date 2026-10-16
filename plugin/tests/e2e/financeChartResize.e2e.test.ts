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
    const result = cli.evalAwait<{ widths: number[][]; shot: string }>(
      `(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
      const ws = app.workspace
      const win = require('@electron/remote').getCurrentWindow()
      win.setContentSize(${mobile ? '390, 844' : '1280, 900'})
      const folder = 'SampleChartResize'
      const leftCollapsed = ws.leftSplit.collapsed
      const rightCollapsed = ws.rightSplit.collapsed
      let leaf
      let createdFolder = false
      try {
        await app.vault.createFolder(folder)
        createdFolder = true
        const note = fm => '---\\n' + fm + '\\n---\\n'
        await app.vault.create(folder + '/Sample wallet.md', note('type: account\\naccountType: asset\\ncurrency: EUR'))
        await app.vault.create(folder + '/Sample spending.md', note('type: account\\naccountType: expense'))
        const d = new Date()
        const date = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
        await app.vault.create(folder + '/Sample purchase.md', note('type: transaction\\ndate: ' + date + '\\nfrom: "[[Sample wallet]]"\\nto: "[[Sample spending]]"\\namount: 25\\ncurrency: EUR'))
        leaf = ws.getRightLeaf(true)
        await leaf.setViewState({ type: 'abele-finance-sidebar-view', active: true })
        ws.rightSplit.expand()
        await ws.revealLeaf(leaf)
        const chart = () => leaf.view.containerEl.querySelector('.abele-finance-sidebar__pie-chart')
        const deadline = Date.now() + 20000
        while (!chart()?.querySelector('canvas') && Date.now() < deadline) await wait(100)
        if (!chart()?.querySelector('canvas')) throw Error('Missing seeded finance chart')
        const widths = []
        for (let i = 0; i < 3; i++) {
          ws.leftSplit.expand()
          ws.rightSplit.collapse()
          await wait(200)
          ws.leftSplit.collapse()
          ws.rightSplit.expand()
          await ws.revealLeaf(leaf)
          await wait(500)
          const el = chart()
          const canvas = el.querySelector('canvas')
          // The intrinsic drawing buffer detects a stale chart even if CSS stretches it.
          widths.push([el.clientWidth, parseFloat(canvas.style.width), canvas.width / devicePixelRatio])
        }
        chart().scrollIntoView({ block: 'center' })
        await wait(200)
        const shot = ${JSON.stringify(shots)} + '/finance-' + ${JSON.stringify(mobile ? 'phone' : 'desktop')} + '.png'
        const image = await win.webContents.capturePage()
        require('node:fs').writeFileSync(shot, image.toPNG())
        return { widths, shot }
      } finally {
        leaf?.detach()
        if (leftCollapsed) ws.leftSplit.collapse(); else ws.leftSplit.expand()
        if (rightCollapsed) ws.rightSplit.collapse(); else ws.rightSplit.expand()
        const dir = app.vault.getAbstractFileByPath(folder)
        if (createdFolder && dir) await app.vault.delete(dir, true)
      }
    })()`,
      60_000
    )
    expect(result.widths).toHaveLength(3)
    for (const [container, css, buffer] of result.widths) {
      expect(container).toBeGreaterThan(1)
      expect(Math.abs(css - container)).toBeLessThanOrEqual(1)
      expect(Math.abs(buffer - container)).toBeLessThanOrEqual(1)
    }
    expect(result.shot).toMatch(/\.png$/)
  })
})
