import { afterAll, describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { evalJson, evalLong } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { designCaptureExpression } from '../helpers/designCapture'
import { lintDesign, type DesignSnapshot } from '../helpers/designLint'

targets('desktop', 'phone')
const directory = shotDir('agents-list')
const states = ['empty', 'waiting', 'many', 'working', 'error', 'mixed'] as const
const close = `document.querySelector('.modal-close-button')?.click()`

afterAll(async () => {
  await evalLong(`(() => { ${close}; return 'closed' })()`)
})

describe('real agents list on synthetic states', () => {
  for (const state of states) {
    it(`${state} keeps native rows, labelled states, one close and no overflow`, async () => {
      const path = join(directory, `${state}-${onPhone() ? 'phone' : 'desktop'}.png`)
      const raw = await evalLong(`(async () => {
        ${close}
        app.workspace.leftSplit.expand()
        window.__abeleTest.openDialog('agents', { agentsState: ${JSON.stringify(state)} })
        await new Promise(r => setTimeout(r, 400))
        await document.fonts.ready
        const root = document.querySelector('.abele-agents')
        if (!root) throw new Error('Agents list did not mount')
        const snapshot = ${designCaptureExpression('.modal.abele-modal')}
        const overflowing = [...root.querySelectorAll('*')].filter(el => {
          const r = el.getBoundingClientRect()
          return r.width && (r.left < 0 || r.right > innerWidth + 1)
        }).map(el => el.className)
        const closes = document.querySelectorAll('.modal .modal-close-button').length
        const searchFocused = root.querySelector('input') === document.activeElement
        const rows = root.querySelectorAll('.abele-list-row').length
        if (window.__e2eHost) await window.__e2eHost.shot(${JSON.stringify(path)})
        else {
          const win = require('@electron/remote').getCurrentWindow()
          require('fs').writeFileSync(${JSON.stringify(path)}, (await win.webContents.capturePage()).toPNG())
        }
        return JSON.stringify({ snapshot, overflowing, closes, searchFocused, rows })
      })()`)
      const result = JSON.parse(raw) as {
        snapshot: DesignSnapshot
        overflowing: string[]
        closes: number
        searchFocused: boolean
        rows: number
      }
      expect(result.overflowing).toEqual([])
      expect(result.closes).toBe(1)
      expect(result.searchFocused).toBe(false)
      expect(result.rows).toBe(
        state === 'empty' ? 0 : state === 'many' ? 4 : state === 'mixed' ? 3 : 1
      )
      const violations = lintDesign(result.snapshot, { requireNative: true })
      writeFileSync(
        join(directory, `${state}-${onPhone() ? 'phone' : 'desktop'}-lint.json`),
        JSON.stringify({ snapshot: result.snapshot, violations }, null, 2)
      )
      expect(violations).toEqual([])
    })
  }
  it.skipIf(onPhone())(
    'activates the native opening button once for Enter and once for Space',
    async () => {
      const result = await evalLong(`(async () => {
      ${close}
      window.__abeleTest.openDialog('agents', { agentsState: 'waiting' })
      await new Promise(r => setTimeout(r, 200))
      const button = document.querySelector('.abele-list-row__main')
      let clicks = 0
      button.addEventListener('click', () => clicks++)
      const contents = require('@electron/remote').getCurrentWindow().webContents
      for (const key of ['Enter', ' ']) {
        button.focus()
        await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key === 'Enter' ? 'Enter' : 'Space', windowsVirtualKeyCode: key === 'Enter' ? 13 : 32 })
        await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key === 'Enter' ? 'Enter' : 'Space', windowsVirtualKeyCode: key === 'Enter' ? 13 : 32 })
      }
      return JSON.stringify({ clicks, focused: document.activeElement === button })
    })()`)
      expect(JSON.parse(result)).toEqual({ clicks: 2, focused: true })
      expect(evalJson("!!document.querySelector('.abele-agents')")).toBe(true)
    }
  )
})
