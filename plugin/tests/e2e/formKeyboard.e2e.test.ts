/**
 * Typing into a long form on a phone, the keyboard up.
 *
 * An invented script's `form()` has thirteen generated fields, ending in a note field backed by
 * Obsidian's editor. As text is entered into the final fields, the active field and caret must
 * remain visible above the simulated keyboard and editing toolbar, along with the Run button.
 *
 * On the desktop the phone is Obsidian's layout for one (`emulateMobile`) in a 390×844 window, the
 * keyboard written as Obsidian's iPhone app writes it (`--keyboard-height` on the root, announced
 * with `keyboardWillShow`), the typing real key input through the DevTools protocol. On a real
 * phone (`npm run test:e2e:phone`) the fields are tapped and typed into with the system keyboard.
 * Pictures in `/tmp/abele-phone/form-keyboard-*.png` (the phone's in `/tmp/abele-iphone/`).
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
  runCli,
} from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { tap, typeText } from './helpers/phone'

targets('desktop', 'phone')

const PHONE = { width: 390, height: 844 }
/** An iPhone keyboard with its suggestion bar, in points. */
const KEYBOARD = 336
const SHOTS = '/tmp/abele-phone'

interface Typed {
  /** The field's top and bottom — the caret's line, for the note field — after typing. */
  field: [number, number]
  /** Where the keyboard starts, and Obsidian's toolbar over it, if it shows. */
  keyboardTop: number
  toolbarTop: number | null
  /** The dialog's top edge, and the bottom of the Run button in its pinned row. */
  dialogTop: number
  /** What the dialog's body shows: its top and bottom. */
  body: [number, number]
  run: number
  /** What the field holds once typed into. */
  value: string
  shot: string
  error: string
}

type Report = Record<string, Typed>

/**
 * The probe's steps, put on the page as `window.__formProbe`. On the desktop one script runs them
 * all. On a phone the test runs them one call at a time and touches and types in between from
 * here: the phone's driver waits for the app to be idle before each touch, and while the page was
 * being asked every second whether a long script had finished, it waited out a tap into the note
 * field until the request gave up.
 */
const probeLib = `(() => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (fn()) return true
      await wait(100)
    }
    return false
  }
  const host = window.__e2eHost
  const fs = host ? null : require('fs')
  const win = host ? null : require('@electron/remote').getCurrentWindow()
  const cdp = host ? null : require('@electron/remote').getCurrentWebContents().debugger
  if (fs) fs.mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })

  let nudged = false
  const shoot = async (label) => {
    const path = ${JSON.stringify(SHOTS)} + '/form-keyboard-' + label + '.png'
    if (host) { await wait(500); return host.shot(path) }
    if (!nudged) {
      nudged = true
      const [w, h] = win.getContentSize()
      win.setContentSize(w + 2, h + 2)
      await wait(300)
      win.setContentSize(w, h)
    }
    await wait(400)
    let img
    try { img = await win.webContents.capturePage() } catch (error) {
      if (!String(error && error.message).includes('UnknownVizError')) throw error
      await wait(300)
      img = await win.webContents.capturePage()
    }
    fs.writeFileSync(path, img.toPNG())
    return path
  }

  const keyboardHeight = () =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-height')) || 0

  const fieldOf = (which) => which === 'last-field'
    ? [...document.querySelectorAll('.modal .abele-script-form__input')].pop()
    : document.querySelector('.modal .abele-script-form .cm-content')

  const caretOf = (editor) => {
    const view = window.__abeleTest.noteFieldView(editor.closest('.cm-editor').parentElement) ||
      window.__abeleTest.noteFieldView(editor.closest('.cm-editor'))
    if (view && view.coordsAtPos) {
      const c = view.coordsAtPos(view.state.selection.main.head)
      if (c) return c
    }
    return editor.querySelector('.cm-line:last-child').getBoundingClientRect()
  }

  window.__formProbe = {
    async open() {
      const fields = Array.from({ length: 12 }, (_, i) => ({ name: 'f' + i, label: 'Field ' + (i + 1), type: 'text' }))
      fields.push({ name: 'notes', label: 'Notes', type: 'note' })
      window.__abeleTest.showFormModal(fields)
      if (!(await until(() => document.querySelector('.modal .abele-script-form .cm-content'), 8000))) throw new Error('the form did not open with its note field')
      for (const el of document.querySelectorAll('.modal, .modal-container')) el.style.transition = 'none'
      await wait(400)
      // A field of the form had the focus from the start; out of it, so the keyboard comes up
      // for the one touched.
      document.activeElement && document.activeElement.blur()
      await until(() => keyboardHeight() === 0, 5000)
      await wait(1000)
      return 'open'
    },
    // Brought into sight, and where to touch it once nothing moves any more.
    async aim(which) {
      const el = fieldOf(which)
      el.scrollIntoView({ block: 'center' })
      await wait(600)
      const r = el.getBoundingClientRect()
      return [Math.round(r.left + r.width / 2), Math.round(r.top + Math.min(r.height / 2, 20))]
    },
    // Has the focus — on a phone the touch must have given it, or the text would be typed into
    // nothing, which stops the phone's driver — and the keyboard is up: the real one, or on the
    // desktop the one Obsidian's iPhone app reports.
    async focused(which) {
      const el = fieldOf(which)
      if (!host) el.focus()
      const has = () => document.activeElement === el || el.contains(document.activeElement)
      if (!(await until(has, 3000))) throw new Error('the touch did not reach ' + which)
      if (host) {
        await until(() => keyboardHeight() > 0, 5000)
        // Until the keyboard has finished coming up: letters typed while it slides in are lost.
        await wait(1800)
      } else {
        document.documentElement.style.setProperty('--keyboard-height', '${KEYBOARD}px')
        const shown = new Event('keyboardWillShow')
        shown.keyboardHeight = ${KEYBOARD}
        window.dispatchEvent(shown)
        await wait(600)
      }
      return 'focused'
    },
    // Real key input through the DevTools protocol; the desktop's only.
    async type(text) {
      for (const part of text.split('\\n').flatMap((p, i) => (i ? ['\\n', p] : [p]))) {
        if (part === '\\n') {
          const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }
          await cdp.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key })
          await cdp.sendCommand('Input.dispatchKeyEvent', { type: 'char', ...key, text: '\\r' })
          await cdp.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
        } else if (part) await cdp.sendCommand('Input.insertText', { text: part })
        await wait(120)
      }
      return 'typed'
    },
    async measure(which) {
      await wait(800)
      const el = fieldOf(which)
      const fieldRect = which === 'last-field' ? el.getBoundingClientRect() : caretOf(el)
      const dialog = document.querySelector('.modal.abele-modal')
      const run = [...dialog.querySelectorAll('.abele-modal__footer button')].find((b) => b.textContent.trim() === 'Run')
      const bar = document.querySelector('.mobile-toolbar')
      const barRect = bar && bar.getBoundingClientRect()
      const body = dialog.querySelector('.abele-modal__body').getBoundingClientRect()
      return {
        field: [Math.round(fieldRect.top), Math.round(fieldRect.bottom)],
        keyboardTop: Math.round(window.innerHeight - keyboardHeight()),
        toolbarTop: barRect && barRect.height > 0 && getComputedStyle(bar).display !== 'none' ? Math.round(barRect.top) : null,
        dialogTop: Math.round(dialog.getBoundingClientRect().top),
        body: [Math.round(body.top), Math.round(body.bottom)],
        run: run ? Math.round(run.getBoundingClientRect().bottom) : 9999,
        value: which === 'last-field' ? el.value : el.innerText,
        shot: await shoot(which),
        error: '',
      }
    },
    async close() {
      document.activeElement && document.activeElement.blur()
      if (!host) {
        document.documentElement.style.removeProperty('--keyboard-height')
        window.dispatchEvent(new Event('keyboardWillHide'))
      }
      await until(() => keyboardHeight() === 0, 5000)
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
      await until(() => !document.querySelector('.modal'), 3000)
      return 'closed'
    },
  }
  return 'installed'
})()`

const TEXT: Record<string, string> = {
  'last-field': 'hello',
  'note-field': 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten',
}

/** One step of the probe, awaited in the page. */
const step = async (call: string): Promise<unknown> =>
  JSON.parse(await evalLong(`(async () => JSON.stringify(await window.__formProbe.${call}))()`, 60_000))

/** The whole probe: on the desktop in the page, on a phone with real touches and typing between. */
async function runProbe(): Promise<Report> {
  const report: Report = {}
  let at = 'start'
  try {
    evalRaw(probeLib, 30_000)
    at = 'open'
    await step('open()')
    for (const which of ['last-field', 'note-field']) {
      at = `aim at ${which}`
      const [x, y] = (await step(`aim(${JSON.stringify(which)})`)) as [number, number]
      if (onPhone()) {
        at = `tap ${which}`
        tap(x, y)
      }
      at = `focus ${which}`
      await step(`focused(${JSON.stringify(which)})`)
      at = `type into ${which}`
      // A line at a time on a phone, as a person types.
      if (onPhone()) for (const line of TEXT[which].split(/(?<=\n)/)) typeText(line)
      else await step(`type(${JSON.stringify(TEXT[which])})`)
      at = `measure ${which}`
      report[which] = (await step(`measure(${JSON.stringify(which)})`)) as Typed
    }
  } catch (e) {
    report.run = {
      field: [0, 0],
      keyboardTop: 0,
      toolbarTop: null,
      dialogTop: 0,
      body: [0, 0],
      run: 0,
      value: '',
      shot: '',
      error: `${at}: ${String((e as Error)?.message ?? e)}`,
    }
  } finally {
    try {
      await step('close()')
    } catch {
      // Already gone with a failed step.
    }
  }
  return report
}

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

describe.skipIf(!available)('typing into a long form on a phone, keyboard up', () => {
  let report: Report = {}
  let size: [number, number] = [0, 0]

  beforeAll(async () => {
    size = windowSize()
    await reloadApp('app.emulateMobile(true)')
    await setWindowSize(PHONE.width, PHONE.height)
    // Real key input on the desktop goes through the DevTools protocol.
    if (!onPhone()) runCli(['dev:debug', 'on'], 30_000)
    report = await runProbe()
    const lines = Object.entries(report).map(
      ([label, s]) => `  ${label.padEnd(12)} ${s.shot || s.error}`
    )
    console.info(`\n  vault ...................... ${activeVaultName()}\n${lines.join('\n')}\n`)
  }, 300_000)

  afterAll(async () => {
    if (!available) return
    if (size[0]) await setWindowSize(size[0], size[1])
    await reloadApp('app.emulateMobile(false)')
  }, 120_000)

  it('reaches both fields', () => {
    expect(report.run?.error ?? '').toBe('')
    expect(report['last-field']?.error).toBe('')
    expect(report['note-field']?.error).toBe('')
  })

  it.each(['last-field', 'note-field'])(
    '%s: the keyboard came up and the text went in',
    (label) => {
      const s = report[label]
      expect(s.keyboardTop).toBeLessThan(PHONE.height - 200)
      expect(s.value).toContain(label === 'last-field' ? 'hello' : 'ten')
    }
  )

  it.each(['last-field', 'note-field'])(
    '%s: what is typed stands in the dialog’s body, above the keyboard and the toolbar over it',
    (label) => {
      const s = report[label]
      const floor = Math.min(s.keyboardTop, s.toolbarTop ?? Infinity)
      expect(s.field[0]).toBeGreaterThanOrEqual(s.dialogTop)
      expect(s.field[1]).toBeLessThanOrEqual(floor)
      // In what the body shows, not behind the pinned row of buttons under it.
      expect(s.field[0]).toBeGreaterThanOrEqual(s.body[0])
      expect(s.field[1]).toBeLessThanOrEqual(s.body[1])
    }
  )

  it.each(['last-field', 'note-field'])('%s: the form’s Run stands above the keyboard', (label) => {
    const s = report[label]
    expect(s.run).toBeLessThanOrEqual(Math.min(s.keyboardTop, s.toolbarTop ?? Infinity))
  })
})
