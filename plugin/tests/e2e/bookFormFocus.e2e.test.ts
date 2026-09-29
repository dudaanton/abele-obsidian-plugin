/**
 * A script's dialog over a book keeps the field it was touched in.
 *
 * In a generated book, a selected word opens an invented script's "Script Parameters" dialog:
 * a list and two text fields. Simulate a keyboard resizing the page and triggering book layout.
 * The reader must preserve focus in the active dialog field when it redraws the selection.
 *
 * Here: a plain book, words selected in it, a form of the same shape opened over it, its field
 * touched (on the desktop: focused, then the window made shorter by a keyboard's height, which
 * lays the book out again the same way) and, a while later, the field must still have the focus.
 * On a real phone (`npm run test:e2e:phone`) the touch is a finger's and the keyboard the
 * system's. A picture goes to `/tmp/abele-phone/book-form-focus.png`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  setFocusEmulation,
} from './helpers/obsidianCli'
import { buildPlainEpub } from '../fixtures/books/maliciousBook'
import { onPhone, targets } from './helpers/target'
import { tap } from './helpers/phone'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')

const DIR = 'Abele book form focus e2e'
const BOOK = `${DIR}/plain.epub`
const SHOT = `${shotDir('abele-phone')}/book-form-focus.png`
/** An iPhone keyboard with its suggestion bar, in points. */
const KEYBOARD = 336
const available = isObsidianRunning() && hasTestApi()
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const step = async <T>(body: string, timeout = 60_000): Promise<T> =>
  JSON.parse(
    await evalLong(
      `(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const until = async (fn, ms = 8000) => {
          const deadline = Date.now() + ms
          while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(100) }
          return null
        }
        const field = () => [...document.querySelectorAll('.modal .abele-script-form__input')].find((el) => el.tagName === 'INPUT')
        try { return JSON.stringify(await (async () => { ${body} })()) }
        catch (e) { return JSON.stringify({ error: String((e && e.stack) || e) }) }
      })()`,
      timeout
    )
  ) as T

interface Report {
  error?: string
  selected?: string
  relocated?: number
  focused?: boolean
  active?: string
  keyboard?: number
  shot?: string
}

describe.skipIf(!available)('a script’s dialog over a book with words selected', () => {
  let report: Report = {}
  let size: [number, number] = [0, 0]

  beforeAll(async () => {
    setFocusEmulation(true)
    if (!onPhone())
      size = evalJson<[number, number]>(
        `require('@electron/remote').getCurrentWindow().getContentSize()`
      )
    const data = Buffer.from(buildPlainEpub()).toString('base64')
    const opened = await step<Report>(`
      const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
      if (old) await app.vault.delete(old, true)
      await app.vault.createFolder(${JSON.stringify(DIR)})
      const bytes = Uint8Array.from(atob(${JSON.stringify(data)}), (c) => c.charCodeAt(0))
      await app.vault.createBinary(${JSON.stringify(BOOK)}, bytes.buffer)
      const leaf = app.workspace.getLeaf('tab')
      await leaf.setViewState({ type: 'abele-book', state: { file: ${JSON.stringify(BOOK)} }, active: true })
      await app.workspace.revealLeaf(leaf)
      const view = leaf.view
      if (!(await until(() => view.model?.status === 'ready' && view.engine?.lastLocation, 15000))) return { error: 'the book never showed' }
      await view.engine.goTo(view.model.toc[1]?.href ?? view.model.toc[0].href)
      await wait(1000)
      const doc = view.engine.renderer.getContents()[0].doc
      const p = [...doc.querySelectorAll('p')].find((x) => x.textContent.length > 40)
      const range = doc.createRange()
      range.setStart(p.firstChild, 0)
      range.setEnd(p.firstChild, p.firstChild.textContent.indexOf(' '))
      // As a long press leaves it: the page's frame focused, a word selected.
      doc.defaultView.focus()
      doc.getSelection().removeAllRanges()
      doc.getSelection().addRange(range)
      if (!(await until(() => view.model.selection, 3000))) return { error: 'the reader did not take the selection' }
      window.__formFocus = { relocated: 0, view }
      view.engine.renderer.addEventListener('relocate', () => window.__formFocus.relocated++)
      // The form the translation script shows: what it found, a list, two fields.
      window.__abeleTest.showFormModal([
        { name: 'found', label: '', type: 'markdown', text: '**Translation:** a word' },
        { name: 'next', label: 'What next?', type: 'select', options: ['Keep reading', 'Make a card'] },
        { name: 'word', label: 'Word for the card', type: 'text', default: 'word' },
        { name: 'meaning', label: 'Meaning here', type: 'text', default: 'meaning' },
      ])
      if (!(await until(field, 5000))) return { error: 'the form did not open' }
      for (const el of document.querySelectorAll('.modal, .modal-container')) el.style.transition = 'none'
      await wait(500)
      document.activeElement?.blur()
      await wait(800)
      const r = field().getBoundingClientRect()
      return { selected: doc.getSelection().toString(), at: [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] }
    `)
    if (opened.error) {
      report = opened
      return
    }
    const [x, y] = (opened as { at: [number, number] }).at
    if (onPhone()) tap(x, y)
    else {
      evalRaw(
        `(() => { document.querySelector('.modal .abele-script-form__input').focus(); return 'ok' })()`
      )
      // What the keyboard does to the page on a phone: the same page, shorter.
      evalRaw(
        `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1] - KEYBOARD}); return 'ok' })()`
      )
    }
    await pause(onPhone() ? 500 : 0)
    report = await step<Report>(`
      const keyboard = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-height')) || 0
      // Long enough for the keyboard to have come up, the book laid out again and the reader
      // to have drawn its selection after it.
      await wait(3000)
      const active = document.activeElement
      const shot = window.__e2eHost
        ? await window.__e2eHost.shot(${JSON.stringify(SHOT)})
        : (() => {
            const fs = require('fs'); fs.mkdirSync(${JSON.stringify(shotDir('abele-phone'))}, { recursive: true })
            return require('@electron/remote').getCurrentWindow().webContents.capturePage()
              .then((img) => { fs.writeFileSync(${JSON.stringify(SHOT)}, img.toPNG()); return ${JSON.stringify(SHOT)} })
          })()
      return {
        selected: window.__formFocus.view.engine.renderer.getContents()[0].doc.getSelection().toString(),
        relocated: window.__formFocus.relocated,
        focused: active === field(),
        active: active ? active.tagName + '.' + active.className : 'none',
        keyboard: keyboard(),
        shot: await shot,
      }
    `)
    console.info(`\n  book-form-focus ${JSON.stringify(report)}\n`)
  }, 180_000)

  afterAll(async () => {
    if (!available) return
    if (!onPhone() && size[0])
      evalRaw(
        `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]}); return 'ok' })()`
      )
    await step(`
      document.activeElement?.blur()
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
      await until(() => !document.querySelector('.modal'), 3000)
      for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
      const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
      if (dir) await app.vault.delete(dir, true)
      delete window.__formFocus
      return 'ok'
    `)
    setFocusEmulation(false)
  }, 60_000)

  it('opens over the book with the words still selected', () => {
    expect(report.error ?? '').toBe('')
    expect(report.selected).toBeTruthy()
  })

  it('keeps the field touched focused after the book is laid out again under the keyboard', () => {
    // The book was laid out again: otherwise the check proves nothing.
    expect(report.relocated).toBeGreaterThan(0)
    expect(report.active).toMatch(/^INPUT/)
    expect(report.focused).toBe(true)
    if (onPhone()) expect(report.keyboard).toBeGreaterThan(0)
  })
})
