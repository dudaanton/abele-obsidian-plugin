/**
 * The task's date dialog on a phone, with the keyboard up.
 *
 * The keyboard that came up for the time field covered the lower half of the dialog — the
 * field itself, the preset times and the buttons — and nothing could be scrolled to bring them
 * back. The dialog is the plugin's dialog shell: it stands in the room above the keyboard, its
 * body scrolling in it and its buttons pinned under the body, just above the keyboard, with the
 * field being typed into scrolled into sight. (Between 1.37 and 1.48 it kept its full size and
 * its buttons had to be scrolled up from under the keyboard; Obsidian's big sheets still do.)
 *
 * No emulator shows a keyboard, so each of the two ways a platform makes room for one is
 * mimicked separately, in a phone-sized window (390×844) in the layout Obsidian gives a phone:
 *
 * - the page shrinks while the dialog's cap, written in viewport units, does not — the
 *   dialog's container is made shorter by hand;
 * - only the visual viewport shrinks — `window.visualViewport` is replaced for the run by one
 *   that reports the smaller height, before the dialog opens, so the dialog listens to it;
 * - nothing shrinks, and the keyboard's height is written to `--keyboard-height` on the root
 *   element and announced with `keyboardWillShow` — what Obsidian's iPhone app does.
 *
 * The keyboard diagnostics panel is then turned on over the last one and pictured.
 *
 * In both the dialog has to fit the room, scroll inside it, and show the time field. A picture
 * of each is written to `/tmp/abele-phone/task-date-*.png`; look at them. What a real keyboard
 * does is not something the desktop can see: run on a real phone (`npm run test:e2e:phone`), the
 * mimics are left out and the time field is tapped for real, the system keyboard comes up, and
 * the same is asked of the dialog.
 *
 * Writes one task note to the vault for the run and removes it. Restores the window and the
 * desktop layout after itself. Requires Obsidian running on a vault with the development build
 * — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  activeVaultName,
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
} from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')

const PHONE = { width: 390, height: 844 }
/** An iPhone keyboard with its suggestion bar, in points. */
const KEYBOARD = 336
const ROOM = PHONE.height - KEYBOARD
const SHOTS = shotDir('abele-phone')

interface Screen {
  /** The dialog's top and bottom edges. */
  dialog: [number, number]
  /** The time field's top and bottom edges. */
  field: [number, number]
  /** The dialog's scrolling content: everything it holds, and what it shows. */
  content: { scrollHeight: number; clientHeight: number }
  /** The box given room to scroll what the keyboard covers, when the dialog keeps its size. */
  scroller: { scrollHeight: number; clientHeight: number } | null
  /** The lowest button's bottom edge once everything is scrolled up. */
  buttons: number
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
  // On a real phone the harness's host takes the pictures and touches the screen (helpers/phone.ts).
  const host = window.__e2eHost
  const fs = host ? null : require('fs')
  const win = host ? null : require('@electron/remote').getCurrentWindow()
  if (fs) fs.mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })

  let nudged = false
  const shoot = async (label) => {
    if (host) { await wait(500); return host.shot(${JSON.stringify(SHOTS)} + '/task-date-' + label + '.png') }
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
      // The shell's body is what scrolls a dialog.
      const content = dialog.querySelector('.abele-modal__body') || dialog.querySelector('.modal-content')
      const d = dialog.getBoundingClientRect()
      const f = field().getBoundingClientRect()
      entry.dialog = [Math.round(d.top), Math.round(d.bottom)]
      entry.field = [Math.round(f.top), Math.round(f.bottom)]
      entry.content = { scrollHeight: content.scrollHeight, clientHeight: content.clientHeight }
      // What scrolls what the keyboard covers, when the dialog keeps its size over it.
      // Under a real keyboard Obsidian itself stops the dialog's content above it, and the
      // content is what scrolls.
      const scroller = (dialog.classList.contains('abele-keyboard-scroller') ? dialog : dialog.querySelector('.abele-keyboard-scroller')) ??
        (content.scrollHeight > content.clientHeight + 1 ? content : null)
      entry.scroller = scroller ? { scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight } : null
      // The buttons, scrolled to: where they stand then.
      if (scroller) { scroller.scrollTop = scroller.scrollHeight; await wait(100) }
      const buttons = [...dialog.querySelectorAll('button')].map((b) => b.getBoundingClientRect())
      entry.buttons = buttons.length ? Math.round(Math.max(...buttons.map((b) => b.bottom))) : 0
      if (scroller) { scroller.scrollTop = 0; field().scrollIntoView({ block: 'center' }); await wait(100) }
      const f2 = field().getBoundingClientRect()
      entry.field = [Math.round(f2.top), Math.round(f2.bottom)]
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

    if (host) {
      // A finger on the time field, and the phone's own keyboard.
      const f = field().getBoundingClientRect()
      await host.tap(f.left + f.width / 2, f.top + f.height / 2)
      const kb = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-height')) || 0
      await until(() => kb() > 0, 5000)
      await wait(800)
      await measure('real-keyboard')
      report['real-keyboard'].keyboard = kb()
      report['real-keyboard'].screen = window.innerHeight
      field().blur()
      await until(() => kb() === 0, 5000)
      await closeDialog()
      return report
    }

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
    await closeDialog()
    if (realViewport) Object.defineProperty(window, 'visualViewport', realViewport)

    // Obsidian's iPhone app: nothing shrinks, the app writes the keyboard's height on the root
    // element and announces it on the window.
    await openDialog()
    field().focus()
    document.documentElement.style.setProperty('--keyboard-height', '${KEYBOARD}px')
    const shown = new Event('keyboardWillShow')
    shown.keyboardHeight = ${KEYBOARD}
    window.dispatchEvent(shown)
    await wait(600)
    await measure('keyboard-height')

    // The diagnostics panel over the same screen, for a picture of what the owner will see.
    window.__abeleTest.setKeyboardDiagnostics(true)
    await wait(600)
    const panel = document.querySelector('.abele-keyboard-diagnostics')
    const p = panel && panel.getBoundingClientRect()
    const hit = p && document.elementFromPoint(p.left + p.width / 2, p.top + p.height / 2)
    report['diagnostics'] = {
      dialog: p ? [Math.round(p.top), Math.round(p.bottom)] : [0, 0],
      field: [0, 0],
      content: { scrollHeight: 0, clientHeight: 0 },
      container: panel ? 'text ' + panel.textContent.length + ' | tap lands on ' + (hit && panel.contains(hit) ? 'panel' : 'beneath') : 'no panel',
      shot: await shoot('diagnostics'),
      error: panel ? '' : 'no panel',
    }
    window.__abeleTest.setKeyboardDiagnostics(false)
    field().blur()
    document.documentElement.style.removeProperty('--keyboard-height')
    window.dispatchEvent(new Event('keyboardWillHide'))
  } catch (e) {
    report['run'] = { dialog: [0, 0], field: [0, 0], content: { scrollHeight: 0, clientHeight: 0 }, shot: '', error: String((e && e.message) || e) }
  } finally {
    if (realViewport) Object.defineProperty(window, 'visualViewport', realViewport)
    document.documentElement.style.removeProperty('--keyboard-height')
    window.__abeleTest.setKeyboardDiagnostics(false)
    await closeDialog()
    const made = app.vault.getAbstractFileByPath(TASK)
    if (made) await app.vault.delete(made)
  }

  return report
})()`

/** Closes anything standing over the note and switches emulation, letting the reload settle. */
const setMobile = async (on: boolean): Promise<void> => {
  await reloadApp(`app.emulateMobile(${on})`)
}

/** A phone's window is its screen: measured, never set. */
const windowSize = (): [number, number] =>
  onPhone()
    ? evalJson<[number, number]>(`[innerWidth, innerHeight]`, 30_000)
    : evalJson<[number, number]>(
        `require('@electron/remote').getCurrentWindow().getContentSize()`,
        30_000
      )

const setWindowSize = async (width: number, height: number): Promise<void> => {
  if (onPhone()) return
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
    report = JSON.parse(await evalLong(probeScript, 170_000)) as Report

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

  // On a real phone the three mimics give way to the real keyboard.
  const keyboardUp = onPhone()
    ? ['real-keyboard']
    : ['page-shrinks', 'viewport-shrinks', 'keyboard-height']
  const desktop = it.skipIf(onPhone())

  it('reaches every screen', () => {
    expect(report.run?.error ?? '').toBe('')
    for (const label of ['no-keyboard', ...keyboardUp]) {
      expect(report[label], label).toBeDefined()
      expect(report[label].error, label).toBe('')
    }
  })

  desktop('shows the diagnostics panel at the top without taking taps', () => {
    const s = report['diagnostics']
    expect(s?.error ?? 'missing').toBe('')
    expect(s.dialog[0]).toBeGreaterThanOrEqual(0)
    expect(s.dialog[0]).toBeLessThan(80)
    expect(s.container).toContain('tap lands on beneath')
  })

  it('shows the whole dialog when nothing covers the screen', () => {
    const s = report['no-keyboard']
    expect(s.dialog[0]).toBeGreaterThanOrEqual(0)
    expect(s.dialog[1]).toBeLessThanOrEqual(PHONE.height)
    expect(s.content.scrollHeight).toBeLessThanOrEqual(s.content.clientHeight + 1)
  })

  // However the platform makes room for the keyboard — the page shrinking, the visual viewport
  // shrinking, or the keyboard drawn over a page that stays — the dialog stands in the room it
  // leaves, its body scrolls there, and its buttons stand above the keyboard without scrolling.
  desktop.each(['page-shrinks', 'viewport-shrinks', 'keyboard-height'])(
    '%s: the dialog stands in the room the keyboard leaves, its buttons above the keyboard',
    (label) => {
      const s = report[label]
      expect(s.dialog[0]).toBeGreaterThanOrEqual(0)
      expect(s.dialog[1]).toBeLessThanOrEqual(ROOM)
      expect(s.content.scrollHeight).toBeGreaterThan(s.content.clientHeight)
      expect(s.buttons).toBeGreaterThan(0)
      expect(s.buttons).toBeLessThanOrEqual(ROOM)
    }
  )

  it.each(keyboardUp)('%s: the time field is in sight', (label) => {
    const s = report[label] as Screen & { keyboard?: number; screen?: number }
    // The room the real keyboard leaves, where it is one; the mimicked one's otherwise.
    const room = s.keyboard ? s.screen! - s.keyboard : ROOM
    expect(s.field[0]).toBeGreaterThanOrEqual(s.dialog[0])
    expect(s.field[1]).toBeLessThanOrEqual(Math.min(s.dialog[1], room))
  })

  it.runIf(onPhone())(
    'real keyboard: it came up, and scrolled to its end the dialog shows its buttons above it',
    () => {
      const s = report['real-keyboard'] as Screen & { keyboard?: number; screen?: number }
      expect(s?.keyboard ?? 0).toBeGreaterThan(200)
      expect(s.buttons).toBeGreaterThan(0)
      expect(s.buttons).toBeLessThanOrEqual(s.screen! - s.keyboard!)
    }
  )
})
