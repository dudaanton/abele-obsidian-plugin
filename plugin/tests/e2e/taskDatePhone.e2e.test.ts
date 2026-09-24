/**
 * The task's date dialog on a phone, with the keyboard up.
 *
 * The keyboard that came up for the time field covered the lower half of the dialog — the
 * field itself, the preset times and the buttons — and nothing could be scrolled to bring them
 * back. The dialog now stands in the part of the screen the keyboard leaves and scrolls inside
 * it, with the field being typed into scrolled into sight.
 *
 * No emulator shows a keyboard, so each of the two ways a platform makes room for one is
 * mimicked separately, in a phone-sized window (390×844) in the layout Obsidian gives a phone:
 *
 * - the page shrinks while the dialog's cap, written in viewport units, does not — the
 *   dialog's container is made shorter by hand;
 * - only the visual viewport shrinks — `window.visualViewport` is replaced for the run by one
 *   that reports the smaller height, before the dialog opens, so the dialog listens to it.
 *
 * In both the dialog has to fit the room, scroll inside it, and show the time field. A picture
 * of each is written to `/tmp/abele-phone/task-date-*.png`; look at them. What a real keyboard
 * does on a real phone is not something this can see.
 *
 * Writes one task note to the vault for the run and removes it. Restores the window and the
 * desktop layout after itself. Requires Obsidian running on a vault with the development build
 * — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  isObsidianRunning,
  hasTestApi,
  evalRaw,
  evalJson,
  activeVaultName,
} from './helpers/obsidianCli'

const PHONE = { width: 390, height: 844 }
/** An iPhone keyboard with its suggestion bar, in points. */
const KEYBOARD = 336
const ROOM = PHONE.height - KEYBOARD
const SHOTS = '/tmp/abele-phone'

interface Screen {
  /** The dialog's top and bottom edges. */
  dialog: [number, number]
  /** The time field's top and bottom edges. */
  field: [number, number]
  /** The dialog's scrolling content: everything it holds, and what it shows. */
  content: { scrollHeight: number; clientHeight: number }
  /** The container's classes and inline style, and the viewport height it was fitted to. */
  container?: string
  shot: string
  error: string
}

type Report = Record<string, Screen>

const probeScript = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (fn()) return true
      await wait(100)
    }
    return false
  }
  const fs = require('fs')
  const win = require('@electron/remote').getCurrentWindow()
  fs.mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })

  let nudged = false
  const shoot = async (label) => {
    // The first capture after a reload under emulateMobile can hang; a frame produced by a
    // nudge of the window size unsticks it. Later ones do not need it.
    if (!nudged) {
      nudged = true
      const [w, h] = win.getContentSize()
      win.setContentSize(w + 2, h + 2)
      await wait(300)
      win.setContentSize(w, h)
    }
    await wait(500)
    let img
    try {
      img = await win.webContents.capturePage()
    } catch (error) {
      // Electron occasionally answers the first capture after a resize with UnknownVizError;
      // a second try succeeds.
      if (!String(error && error.message).includes('UnknownVizError')) throw error
      await wait(300)
      img = await win.webContents.capturePage()
    }
    const path = ${JSON.stringify(SHOTS)} + '/task-date-' + label + '.png'
    fs.writeFileSync(path, img.toPNG())
    return path
  }

  // The dialog's own Cancel: an Escape sent to the body did not always reach it, and a dialog
  // left open was then measured again as if it were a new one.
  const closeDialog = async () => {
    if (!document.querySelector('.modal')) return
    const cancel = [...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === 'Cancel')
    if (cancel) cancel.click()
    else document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
    )
    if (!(await until(() => !document.querySelector('.modal'), 3000))) throw new Error('the dialog did not close')
  }

  const openDialog = async () => {
    const header = [...document.querySelectorAll('.abele-task-header-view')].find(
      (el) => el.getBoundingClientRect().height > 0
    )
    if (!header) throw new Error('no task header')
    const add = [...header.querySelectorAll('*')].find(
      (el) => el.textContent.trim() === 'Add Date' && el.children.length < 3
    )
    if (!add) throw new Error('no Add Date button')
    add.click()
    await until(() => document.querySelector('.menu .menu-item'), 3000)
    const item = [...document.querySelectorAll('.menu .menu-item')].find((m) => m.textContent === 'Event date')
    if (!item) throw new Error('no Event date item')
    item.click()
    await until(() => document.querySelector('.modal .abele-datetime-picker'), 3000)
    // A hidden window runs no animations; a dialog measured mid-slide reads where it started.
    for (const el of document.querySelectorAll('.modal, .modal-container')) el.style.transition = 'none'
    await wait(300)
  }

  const field = () => document.querySelector('.modal .abele-datetime-picker__time input')

  const measure = async (label) => {
    const entry = { dialog: [0, 0], field: [0, 0], content: { scrollHeight: 0, clientHeight: 0 }, shot: '', error: '' }
    try {
      const dialog = document.querySelector('.modal')
      const content = dialog.querySelector('.modal-content')
      const d = dialog.getBoundingClientRect()
      const f = field().getBoundingClientRect()
      entry.dialog = [Math.round(d.top), Math.round(d.bottom)]
      entry.field = [Math.round(f.top), Math.round(f.bottom)]
      entry.content = { scrollHeight: content.scrollHeight, clientHeight: content.clientHeight }
      entry.container = document.querySelector('.modal-container').className + ' | ' + document.querySelector('.modal-container').style.cssText + ' | vv ' + (window.visualViewport && window.visualViewport.height)
      entry.shot = await shoot(label)
    } catch (e) {
      entry.error = String((e && e.message) || e)
    }
    report[label] = entry
  }

  const report = {}
  const TASK = 'Phone probe task.md'
  const realViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')

  try {
    await closeDialog()
    const file = await app.vault.create(TASK, '---\\ntype: task\\n---\\nPhone probe task\\n')
    await app.workspace.getLeaf(false).openFile(file)
    await until(() => [...document.querySelectorAll('.abele-task-header-view')].some(
      (el) => el.getBoundingClientRect().height > 0), 8000)

    // Nothing covers the screen.
    await openDialog()
    await measure('no-keyboard')

    // The page shrinks, the dialog's cap does not.
    const container = document.querySelector('.modal-container')
    container.style.bottom = 'auto'
    container.style.height = '${ROOM}px'
    field().focus()
    await wait(400)
    await measure('page-shrinks')
    field().blur()
    container.style.removeProperty('height')
    container.style.removeProperty('bottom')
    await closeDialog()

    // Only the visual viewport shrinks. Replaced before the dialog opens, so it listens to it.
    class Viewport extends EventTarget {
      constructor() { super(); this.height = ${PHONE.height}; this.width = ${PHONE.width}; this.offsetTop = 0; this.offsetLeft = 0 }
    }
    const viewport = new Viewport()
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true })
    await openDialog()
    field().focus()
    viewport.height = ${ROOM}
    viewport.dispatchEvent(new Event('resize'))
    await wait(400)
    await measure('viewport-shrinks')
    field().blur()
  } catch (e) {
    report['run'] = { dialog: [0, 0], field: [0, 0], content: { scrollHeight: 0, clientHeight: 0 }, shot: '', error: String((e && e.message) || e) }
  } finally {
    if (realViewport) Object.defineProperty(window, 'visualViewport', realViewport)
    await closeDialog()
    const made = app.vault.getAbstractFileByPath(TASK)
    if (made) await app.vault.delete(made)
  }

  return report
})()`

/** Closes anything standing over the note and switches emulation, letting the reload settle. */
const setMobile = async (on: boolean): Promise<void> => {
  evalRaw(`(() => { app.emulateMobile(${on}); return 'ok' })()`, 30_000)
  await new Promise((resolve) => setTimeout(resolve, 4000))
}

const windowSize = (): [number, number] =>
  evalJson<[number, number]>(
    `require('@electron/remote').getCurrentWindow().getContentSize()`,
    30_000
  )

const setWindowSize = async (width: number, height: number): Promise<void> => {
  evalRaw(
    `(() => {
      require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height})
      return 'ok'
    })()`,
    30_000
  )
  await new Promise((resolve) => setTimeout(resolve, 1500))
}

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)("the task's date dialog on a phone, keyboard up", () => {
  let report: Report = {}
  let size: [number, number] = [0, 0]

  beforeAll(async () => {
    size = windowSize()
    await setMobile(true)
    await setWindowSize(PHONE.width, PHONE.height)
    report = JSON.parse(evalRaw(probeScript, 120_000)) as Report

    const lines = Object.entries(report).map(
      ([label, s]) =>
        `  ${label.padEnd(20)} ${s.shot || s.error}\n  ${''.padEnd(20)} ${s.container ?? ''}`
    )
    console.info(`\n  vault ...................... ${activeVaultName()}\n${lines.join('\n')}\n`)
  }, 300_000)

  afterAll(async () => {
    if (!available) return
    // The window first: leaving emulation reloads the app at whatever size the window is.
    if (size[0]) await setWindowSize(size[0], size[1])
    await setMobile(false)
  }, 120_000)

  const keyboardUp = ['page-shrinks', 'viewport-shrinks']

  it('reaches every screen', () => {
    expect(report.run?.error ?? '').toBe('')
    for (const label of ['no-keyboard', ...keyboardUp]) {
      expect(report[label], label).toBeDefined()
      expect(report[label].error, label).toBe('')
    }
  })

  it('shows the whole dialog when nothing covers the screen', () => {
    const s = report['no-keyboard']
    expect(s.dialog[0]).toBeGreaterThanOrEqual(0)
    expect(s.dialog[1]).toBeLessThanOrEqual(PHONE.height)
    expect(s.content.scrollHeight).toBeLessThanOrEqual(s.content.clientHeight + 1)
  })

  it.each(keyboardUp)('%s: the dialog stands in the room the keyboard leaves', (label) => {
    const s = report[label]
    expect(s.dialog[0]).toBeGreaterThanOrEqual(0)
    expect(s.dialog[1]).toBeLessThanOrEqual(ROOM)
  })

  it.each(keyboardUp)('%s: what does not fit scrolls inside the dialog', (label) => {
    const s = report[label]
    expect(s.content.scrollHeight).toBeGreaterThan(s.content.clientHeight)
  })

  it.each(keyboardUp)('%s: the time field is in sight', (label) => {
    const s = report[label]
    expect(s.field[0]).toBeGreaterThanOrEqual(s.dialog[0])
    expect(s.field[1]).toBeLessThanOrEqual(Math.min(s.dialog[1], ROOM))
  })
})
