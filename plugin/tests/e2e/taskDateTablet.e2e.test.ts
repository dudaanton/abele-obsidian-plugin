/**
 * The task's date dialog on an iPad, with the keyboard up.
 *
 * The phone's fix worked on the owner's iPhone; on his iPad the dialog "scrolled very strangely
 * and the field still ended up under the keyboard". Obsidian's tablet layout stands a dialog in
 * the middle of the screen, not as a sheet, and the keyboard covers less of it or none of it.
 * On a tablet the dialog is now moved up only by what the keyboard covers of it, no higher than
 * the top of the screen; what still does not fit scrolls, the field only when it is covered; and
 * measuring the keyboard again moves nothing.
 *
 * Under `emulateMobile` Obsidian gives a window of at least 600×600 its tablet layout for real.
 * No emulator shows a keyboard, so its height is written to `--keyboard-height` on the root
 * element and announced with `keyboardWillShow`, as Obsidian's iOS app does. Two windows: an
 * iPad in landscape (1180×820, the keyboard covering half of it) and a taller one in portrait,
 * as tall as this screen allows. Each also gets the bar a hardware keyboard leaves on screen,
 * which covers none of the dialog and must move nothing.
 *
 * Pictures go to `/tmp/abele-tablet/task-date-*.png`; look at them. What a real iPad does is not
 * something this can see. Writes one task note for the run and removes it; restores the window
 * and the desktop layout after itself. Requires Obsidian running on a vault with the development
 * build — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { isObsidianRunning, hasTestApi, evalRaw, evalJson } from './helpers/obsidianCli'

const LANDSCAPE = { width: 1180, height: 820, keyboard: 398 }
const PORTRAIT = { width: 820, height: 1000, keyboard: 320 }
/** The bar a hardware keyboard leaves on an iPad's screen. */
const BAR = 55
const SHOTS = '/tmp/abele-tablet'

type Edges = [number, number]

interface Screen {
  dialog: Edges
  field: Edges
  lifted: boolean
  lift: number
  scroller: boolean
  /** The lowest button's bottom once the box that scrolls is scrolled to its end. */
  buttons: number
  scrollTop: number
  shot: string
}

interface Report {
  tablet: boolean
  height: number
  keyboard: number
  screens: Record<string, Screen>
  error: string
}

const probeScript = (label: string, keyboard: number): string => `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { if (fn()) return true; await wait(100) }
    return false
  }
  const fs = require('fs')
  const win = require('@electron/remote').getCurrentWindow()
  win.webContents.setBackgroundThrottling(false)
  fs.mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
  const report = { tablet: document.body.classList.contains('is-tablet'), height: window.innerHeight,
    keyboard: ${keyboard}, screens: {}, error: '' }

  let nudged = false
  const shoot = async (name) => {
    if (!nudged) {
      nudged = true
      const [w, h] = win.getContentSize()
      win.setContentSize(w + 2, h + 2)
      await wait(300)
      win.setContentSize(w, h)
    }
    await wait(500)
    let img
    try { img = await win.webContents.capturePage() } catch (error) {
      if (!String(error && error.message).includes('UnknownVizError')) throw error
      await wait(300)
      img = await win.webContents.capturePage()
    }
    const path = ${JSON.stringify(SHOTS)} + '/task-date-${label}-' + name + '.png'
    fs.writeFileSync(path, img.toPNG())
    return path
  }

  const closeDialog = async () => {
    if (!document.querySelector('.modal')) return
    const cancel = [...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === 'Cancel')
    if (cancel) cancel.click()
    else document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
    if (!(await until(() => !document.querySelector('.modal'), 3000))) throw new Error('the dialog did not close')
  }

  const openDialog = async () => {
    const header = [...document.querySelectorAll('.abele-task-header-view')].find((el) => el.getBoundingClientRect().height > 0)
    if (!header) throw new Error('no task header')
    const add = [...header.querySelectorAll('*')].find((el) => el.textContent.trim() === 'Add Date' && el.children.length < 3)
    if (!add) throw new Error('no Add Date button')
    add.click()
    await until(() => document.querySelector('.menu .menu-item'), 3000)
    const item = [...document.querySelectorAll('.menu .menu-item')].find((m) => m.textContent === 'Event date')
    if (!item) throw new Error('no Event date item')
    item.click()
    await until(() => document.querySelector('.modal .abele-datetime-picker'), 3000)
    for (const el of document.querySelectorAll('.modal, .modal-container')) { el.style.transition = 'none'; el.style.animation = 'none' }
    await wait(300)
  }

  const field = () => document.querySelector('.modal .abele-datetime-picker__time input')
  const edges = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)] }

  const keyboardTo = async (px) => {
    if (px > 0) document.documentElement.style.setProperty('--keyboard-height', px + 'px')
    else document.documentElement.style.removeProperty('--keyboard-height')
    const event = new Event(px > 0 ? 'keyboardWillShow' : 'keyboardWillHide')
    if (px > 0) event.keyboardHeight = px
    window.dispatchEvent(event)
    await wait(600)
  }

  // Measured without touching anything; the buttons only on request, as that scrolls.
  const measure = async (name, buttons) => {
    const dialog = document.querySelector('.modal')
    const container = document.querySelector('.modal-container')
    const scroller = dialog.classList.contains('abele-keyboard-scroller') ? dialog : dialog.querySelector('.abele-keyboard-scroller')
    const entry = {
      dialog: edges(dialog), field: edges(field()),
      lifted: container.classList.contains('abele-keyboard-lift'),
      lift: parseFloat(container.style.getPropertyValue('--abele-keyboard-lift')) || 0,
      scroller: !!scroller, buttons: 0, scrollTop: scroller ? scroller.scrollTop : 0, shot: '',
    }
    entry.shot = await shoot(name)
    if (buttons) {
      const kept = scroller ? scroller.scrollTop : 0
      if (scroller) { scroller.scrollTop = scroller.scrollHeight; await wait(100) }
      const all = [...dialog.querySelectorAll('button')].map((b) => b.getBoundingClientRect().bottom)
      entry.buttons = all.length ? Math.round(Math.max(...all)) : 0
      if (scroller) { scroller.scrollTop = kept; await wait(100) }
    }
    report.screens[name] = entry
  }

  const TASK = 'Tablet probe task.md'
  try {
    await closeDialog()
    const file = await app.vault.create(TASK, '---\\ntype: task\\n---\\nTablet probe task\\n')
    await app.workspace.getLeaf(false).openFile(file)
    await until(() => [...document.querySelectorAll('.abele-task-header-view')].some((el) => el.getBoundingClientRect().height > 0), 8000)

    await openDialog()
    await measure('no-keyboard', false)

    field().focus()
    await wait(300)
    await keyboardTo(${BAR})
    await measure('bar', false)

    await keyboardTo(${keyboard})
    await measure('keyboard', true)

    // The keyboard measured again and again, as the app and the page keep telling it.
    for (let i = 0; i < 5; i++) {
      window.visualViewport && window.visualViewport.dispatchEvent(new Event('resize'))
      window.visualViewport && window.visualViewport.dispatchEvent(new Event('scroll'))
      window.dispatchEvent(new Event('resize'))
      await keyboardTo(${keyboard})
    }
    await measure('again', false)

    await keyboardTo(0)
    field().blur()
    await wait(600)
    await measure('closed', false)
  } catch (e) {
    report.error = String((e && e.message) || e)
  } finally {
    document.documentElement.style.removeProperty('--keyboard-height')
    try { await closeDialog() } catch (e) {}
    const made = app.vault.getAbstractFileByPath(TASK)
    if (made) await app.vault.delete(made)
    win.webContents.setBackgroundThrottling(true)
  }
  return JSON.stringify(report)
})()`

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
    `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
    30_000
  )
  await new Promise((resolve) => setTimeout(resolve, 1500))
}

/** A window behind others keeps its old viewport until it is reloaded. */
const reload = async (): Promise<void> => {
  evalRaw(`(() => { setTimeout(() => window.location.reload(), 50); return 'ok' })()`, 30_000)
  await new Promise((resolve) => setTimeout(resolve, 4000))
  const deadline = Date.now() + 60_000
  while (!hasTestApi() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)("the task's date dialog on an iPad, keyboard up", () => {
  const reports: Record<string, Report> = {}
  let size: [number, number] = [0, 0]

  beforeAll(async () => {
    size = windowSize()
    await setWindowSize(LANDSCAPE.width, LANDSCAPE.height)
    await setMobile(true)
    await reload()
    reports.landscape = JSON.parse(
      evalRaw(probeScript('landscape', LANDSCAPE.keyboard), 120_000)
    ) as Report
    await setWindowSize(PORTRAIT.width, PORTRAIT.height)
    await reload()
    reports.portrait = JSON.parse(
      evalRaw(probeScript('portrait', PORTRAIT.keyboard), 120_000)
    ) as Report
    console.info(`\n  ${JSON.stringify(reports, null, 1)}\n`)
  }, 300_000)

  afterAll(async () => {
    if (!available) return
    if (size[0]) await setWindowSize(size[0], size[1])
    await setMobile(false)
  }, 120_000)

  describe.each(['landscape', 'portrait'])('%s', (orientation) => {
    const report = () => reports[orientation]
    const screen = (name: string) => report().screens[name]
    const keyboardTop = () => report().height - report().keyboard

    it('runs in the tablet layout and reaches every screen', () => {
      expect(report().error).toBe('')
      expect(report().tablet).toBe(true)
      for (const name of ['no-keyboard', 'bar', 'keyboard', 'again', 'closed'])
        expect(screen(name), name).toBeDefined()
    })

    it('stands where Obsidian put it while the keyboard covers none of it', () => {
      const whole = screen('no-keyboard')
      const bar = screen('bar')
      // The hardware keyboard's bar reaches nowhere near a dialog in the middle of the screen.
      expect(whole.dialog[1]).toBeLessThan(report().height - BAR)
      expect(bar.lifted).toBe(false)
      expect(bar.dialog).toEqual(whole.dialog)
      expect(bar.field).toEqual(whole.field)
    })

    it('moves up no further than the keyboard covers it, and keeps its size', () => {
      const whole = screen('no-keyboard')
      const s = screen('keyboard')
      const height = whole.dialog[1] - whole.dialog[0]
      expect(Math.abs(s.dialog[1] - s.dialog[0] - height)).toBeLessThanOrEqual(1)
      expect(s.dialog[0]).toBeGreaterThanOrEqual(0)
      if (whole.dialog[1] <= keyboardTop()) {
        expect(s.lifted).toBe(false)
      } else {
        expect(s.lifted).toBe(true)
        expect(s.lift).toBeLessThanOrEqual(whole.dialog[1] - keyboardTop() + 12 + 1)
      }
    })

    it('has the time field in sight above the keyboard, and the buttons within reach', () => {
      const s = screen('keyboard')
      expect(s.field[0]).toBeGreaterThanOrEqual(0)
      expect(s.field[1]).toBeLessThanOrEqual(keyboardTop())
      expect(s.buttons).toBeLessThanOrEqual(keyboardTop())
    })

    it('does not move when the keyboard is measured again', () => {
      const s = screen('keyboard')
      const again = screen('again')
      expect(again.dialog).toEqual(s.dialog)
      expect(again.field).toEqual(s.field)
      expect(again.scrollTop).toBe(s.scrollTop)
    })

    it('goes back where it was once the keyboard goes', () => {
      expect(screen('closed').lifted).toBe(false)
      expect(screen('closed').dialog).toEqual(screen('no-keyboard').dialog)
    })
  })
})
