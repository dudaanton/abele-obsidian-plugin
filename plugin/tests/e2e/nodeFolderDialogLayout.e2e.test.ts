import { afterAll, describe, expect, it } from 'vitest'
import {
  activeVaultName,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  restoreDesktopWindow,
  vaultCli,
} from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

/**
 * The node's "Open folder on node" dialog. On a desktop it is as tall as what it holds, the way
 * Obsidian's own pickers are: it once stood at the full dialog height with a short list and the
 * buttons at the top, three quarters of it empty. On a phone it is their sheet, the list filling
 * it and the buttons at its bottom.
 */
targets('desktop')
const available = isObsidianRunning() && hasTestApi()
const shots = shotDir('node-folder-dialog')

afterAll(async () => {
  if (available) await restoreDesktopWindow()
})

interface Layout {
  mobile: boolean
  sheet: boolean
  /** Window height, the dialog's top and bottom, the button row's bottom, the list's box. */
  window: number
  top: number
  bottom: number
  actions: number
  /** Where the dialog's body ends, short of its padding: what is under it is the dialog's frame. */
  body: number
  /** Obsidian's own margin under a button row: on a phone the home indicator's inset. */
  inset: number
  listTop: number
  listBottom: number
  /** Rows the list holds and rows it shows whole. */
  rows: number
  shown: number
  shot: string
}

describe.skipIf(!available)('node folder dialog layout', () => {
  it.each([false, true])('fits its content, or the phone sheet, on mobile=%s', async (mobile) => {
    await reloadApp(`app.emulateMobile(${mobile})`)
    const cli = vaultCli(activeVaultName())
    const size = mobile ? [390, 844] : [1280, 900]
    const layout = cli.evalAwait<Layout>(`(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
      const win = require('@electron/remote').getCurrentWindow()
      win.setContentSize(${size[0]}, ${size[1]})
      await wait(300)
      const opening = window.__abeleTest.openDialog('node-folder-picker')
      let modal
      for (let i = 0; i < 50 && !modal; i++) {
        await wait(100)
        modal = [...document.querySelectorAll('.modal.abele-modal')].find(m => m.querySelector('.abele-folder-picker__row'))
      }
      if (!modal) throw Error('The folder dialog did not open')
      await wait(500)
      try {
        const box = modal.getBoundingClientRect()
        const list = modal.querySelector('.abele-folder-picker__list').getBoundingClientRect()
        const row = modal.querySelector('.abele-folder-picker .modal-button-container')
        const actions = row.getBoundingClientRect()
        const rows = [...modal.querySelectorAll('.abele-folder-picker__row')]
        const shown = rows.filter(row => {
          const r = row.getBoundingClientRect()
          return r.top >= list.top - 1 && r.bottom <= list.bottom + 1
        }).length
        const image = await win.webContents.capturePage()
        const shot = ${JSON.stringify(shots)} + '/${mobile ? 'phone' : 'desktop'}.png'
        require('node:fs').writeFileSync(shot, image.resize({ width: innerWidth, height: innerHeight }).toPNG())
        return {
          mobile: !!app.isMobile,
          sheet: modal.classList.contains('mod-lg'),
          window: innerHeight,
          top: Math.round(box.top),
          bottom: Math.round(box.bottom),
          actions: Math.round(actions.bottom),
          inset: Math.round(parseFloat(getComputedStyle(row).marginBottom)),
          body: (() => {
            const el = modal.querySelector('.abele-modal__body')
            return Math.round(el.getBoundingClientRect().bottom - parseFloat(getComputedStyle(el).paddingBottom))
          })(),
          listTop: Math.round(list.top),
          listBottom: Math.round(list.bottom),
          rows: rows.length,
          shown,
          shot,
        }
      } finally {
        modal.querySelector('.modal-close-button')?.click()
        await opening?.catch(() => {})
      }
    })()`)
    expect(layout.mobile).toBe(mobile)
    expect(layout.window).toBe(size[1])
    // Everything the made-up home folder holds, plus the row that goes up.
    expect(layout.rows).toBe(13)
    // The buttons are the last thing in the dialog: under them in its body only the margin
    // Obsidian keeps for the home indicator, under the body only its frame, never a stretch of
    // empty sheet.
    expect(layout.body - layout.actions).toBeLessThanOrEqual(layout.inset + 4)
    expect(layout.bottom - layout.body).toBeLessThanOrEqual(64)
    // And they are on the screen, not under its bottom edge.
    expect(layout.actions).toBeLessThanOrEqual(layout.window)
    if (mobile) {
      // Their sheet, reaching the bottom of the screen, and the list using the room it has.
      expect(layout.sheet).toBe(true)
      expect(layout.bottom).toBeGreaterThanOrEqual(layout.window - 1)
      expect(layout.top).toBeLessThan(layout.window / 4)
      expect(layout.shown).toBeGreaterThanOrEqual(8)
    } else {
      // A centred dialog sized by what it holds, the list showing a page of folders. Their
      // `mod-lg` may be on it: every rule they have for it is a phone rule.
      expect(layout.bottom - layout.top).toBeLessThan(layout.window * 0.75)
      expect(layout.shown).toBeGreaterThanOrEqual(6)
    }
  })
})
