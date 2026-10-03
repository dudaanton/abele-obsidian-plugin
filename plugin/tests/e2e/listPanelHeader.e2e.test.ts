import { describe, expect, it } from 'vitest'
import { evalLong, evalRaw, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'

targets('desktop', 'phone')
describe('main-pane list headers below native phone chrome', () => {
  it('keeps every list panel below the status bar and native view header', async () => {
    let size: number[] | undefined
    try {
      if (!onPhone()) {
        size = JSON.parse(
          evalRaw(`JSON.stringify(require('@electron/remote').getCurrentWindow().getContentSize())`)
        )
        await reloadApp('app.emulateMobile(true)')
        evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390,844); 'sized'`)
        await reloadApp()
      }
      const result = JSON.parse(
        await evalLong(`(async () => {
        const previous = app.workspace.activeLeaf
        const leaves = []
        const rows = []
        const frame = () => new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Error('window is not drawing')), 5000)
          requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve() }))
        })
        try {
          for (const [type, selector] of [
            ['abele-time-tracking-sidebar-view', '.abele-time-tracking-sidebar__header'],
            ['abele-todo-sidebar-view', '.abele-todo-list__header'],
            ['abele-finance-sidebar-view', '.abele-finance-sidebar__header'],
            ['abele-accounts-sidebar-view', '.abele-accounts-sidebar__header']
          ]) {
            const leaf = app.workspace.getLeaf('tab'); leaves.push(leaf)
            await leaf.setViewState({ type, active: true }); await app.workspace.revealLeaf(leaf)
            let header
            const deadline = Date.now() + 15000
            while (Date.now() < deadline) {
              header = leaf.view.containerEl.querySelector(selector)
              if (header?.getBoundingClientRect().height > 0) break
              await new Promise(r => setTimeout(r, 50))
            }
            if (!header?.getBoundingClientRect().height) throw Error('list header did not render: ' + type)
            await frame()
            const panel = header.closest('.abele-sidebar-panel')
            const style = getComputedStyle(panel)
            const safe = parseFloat(style.getPropertyValue('--safe-area-inset-top')) || 0
            const nativeHeight = parseFloat(style.getPropertyValue('--view-header-height')) || 0
            const native = leaf.view.containerEl.querySelector('.view-header')?.getBoundingClientRect().bottom || 0
            rows.push({ type, top: header.getBoundingClientRect().top, nativeBottom: Math.max(native, safe + nativeHeight) })
          }
          return rows
        } finally {
          for (const leaf of leaves) leaf.detach()
          if (previous) app.workspace.setActiveLeaf(previous, { focus: true })
        }
      })()`)
      )
      console.info(JSON.stringify(result))
      expect(result).toHaveLength(4)
      for (const row of result) expect(row.top, row.type).toBeGreaterThanOrEqual(row.nativeBottom)
    } finally {
      if (size) {
        await reloadApp('app.emulateMobile(false)')
        evalRaw(
          `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]},${size[1]}); 'restored'`
        )
        await reloadApp()
      }
    }
  })
})
