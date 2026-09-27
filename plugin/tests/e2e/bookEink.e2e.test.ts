/**
 * E-ink mode in the running app (`src/reader/eink.ts`), switched on by its command:
 *
 * - nothing in the book tab or on its page has a transition, however it was styled;
 * - highlights are drawn as lines, a book's and a PDF's, not as a pale fill;
 * - the tab takes the focus when a book opens, and Page Down sent as a real key — through the
 *   DevTools protocol, to whatever holds the focus — turns the page, of a book and of a PDF,
 *   which the mode lays out a page at a time;
 * - under `emulateMobile`, after a reload that keeps the mode (it is the device's own), a tap in
 *   the right third turns the page and a swipe leaves the page where it is until the finger
 *   lifts, then turns it once;
 * - switched off, the tab is as before.
 *
 * The mode is kept in the app's local storage; it is put back to off, and the window to the
 * desktop, when the file ends.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evalRaw, hasTestApi, isObsidianRunning, reloadApp, runCli } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildProseEpub } from '../fixtures/books/proseBook'
import { buildRichEpub } from '../fixtures/books/richBook'
import { buildPlainPdf } from '../fixtures/books/pdfFixture'
import { targets } from './helpers/target'

targets('desktop')

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader eink e2e'
const PROSE = `${DIR}/prose.epub`
const RICH = `${DIR}/rich.epub`
const PDF = `${DIR}/plain.pdf`

const reload = async (how: string): Promise<void> => {
  await reloadApp(how)
  runCli(['dev:debug', 'on'], 30_000)
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWebContents().setBackgroundThrottling(false); return 'ok' })()`
  )
}

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 15000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(50) }
    return null
  }
  const api = window.__abeleTest.reader
  const cdp = require('@electron/remote').getCurrentWebContents().debugger
  const open = async (path) => {
    const old = app.workspace.getLeavesOfType('abele-book')
    let leaf
    try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.getLeaf(false) }
    for (const l of old) if (l !== leaf) l.detach()
    await leaf.setViewState({ type: 'abele-book', state: { file: path }, active: true })
    const view = leaf.view
    await until(() => view.model?.status === 'ready', 15000)
    await wait(800)
    return { leaf, view }
  }
  /** A key pressed as the keyboard presses it: to whatever holds the focus. */
  const press = async (key, code, keyCode) => {
    await cdp.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode })
    await cdp.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode })
    await wait(700)
  }
  const touch = (type, points = []) => cdp.sendCommand('Input.dispatchTouchEvent', {
    type, touchPoints: points.map(([x, y], id) => ({ x: Math.round(x), y: Math.round(y), id })),
  })
  const toggle = () => app.commands.executeCommandById('abele:reader-toggle-eink')
  const R = (view) => view.engine.renderer
  const where = (view) => view.engine.lastLocation?.cfi ?? ''
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    44_000
  )

describe.skipIf(!available)('e-ink mode', () => {
  beforeAll(async () => {
    const files = {
      'prose.epub': Buffer.from(buildProseEpub()).toString('base64'),
      'rich.epub': Buffer.from(buildRichEpub()).toString('base64'),
      'plain.pdf': Buffer.from(buildPlainPdf()).toString('base64'),
    }
    evalRaw(
      `(async () => {
        window.__abeleTest.reader.eink.set({ on: false, refreshEvery: 0, showKeys: false })
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        for (const [name, data] of Object.entries(${JSON.stringify(files)})) {
          const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
          await app.vault.createBinary(${JSON.stringify(DIR)} + '/' + name, bytes.buffer)
        }
        return 'ok'
      })()`,
      44_000
    )
    runCli(['dev:debug', 'on'], 30_000)
  }, 60_000)

  afterAll(async () => {
    evalRaw(
      `(async () => {
        window.__abeleTest.reader.eink.set({ on: false, refreshEvery: 0, showKeys: false })
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
        for (const leaf of app.workspace.getLeavesOfType('markdown'))
          if (leaf.view.file?.path?.startsWith(${JSON.stringify(DIR)})) leaf.detach()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        return 'ok'
      })()`,
      44_000
    )
    if (evalRaw(`String(app.isMobile)`) === 'true') await reload('app.emulateMobile(false)')
  }, 120_000)

  it('computes no transition anywhere in the tab or on the page once it is on', () => {
    const r = run<{
      error?: string
      before?: string
      on?: boolean
      after?: string
      moving?: string[]
      page?: string
      animated?: boolean
      flow?: string | null
    }>(`
      api.eink.set({ on: false })
      const { leaf, view } = await open(${JSON.stringify(PROSE)})
      // Styled to move, as a theme or a later change might: the mode must still hold it still.
      const probe = view.contentEl.querySelector('.abele-book-reader__foot').createDiv()
      probe.style.transition = 'opacity 1s'
      const before = getComputedStyle(probe).transitionDuration
      await toggle()
      await wait(800)
      const on = view.contentEl.classList.contains('abele-book_eink')
      const after = getComputedStyle(probe).transitionDuration
      const moving = [...view.contentEl.querySelectorAll('*')]
        .filter((el) => getComputedStyle(el).transitionDuration.split(',').some((d) => parseFloat(d) > 0)
          || getComputedStyle(el).animationName !== 'none')
        .map((el) => el.className)
      const doc = R(view).getContents()[0].doc
      const p = doc.querySelector('p')
      p.style.transition = 'color 1s'
      const page = getComputedStyle(p).transitionDuration
      probe.remove()
      return { before, on, after, moving, page, animated: R(view).hasAttribute('animated'), flow: R(view).getAttribute('flow') }
    `)
    expect(r.error).toBeUndefined()
    expect(r.before).toBe('1s')
    expect(r.on).toBe(true)
    expect(r.after).toBe('0s')
    expect(r.moving).toEqual([])
    expect(r.page).toBe('0s')
    expect(r.animated).toBe(false)
    expect(r.flow).toBe('paginated')
  })

  it('takes the focus as a book opens, and turns its page on Page Down', () => {
    const r = run<{
      error?: string
      focused?: boolean
      before?: string
      after?: string
      back?: string
    }>(`
      api.eink.set({ on: true })
      // What a book is opened from has the focus: the file list, here a stand-in for it.
      const before0 = document.body.createDiv({ attr: { tabindex: '0' } })
      before0.focus()
      const { view } = await open(${JSON.stringify(PROSE)})
      const focused = view.contentEl.contains(document.activeElement)
      before0.remove()
      await view.engine.goTo(1)
      await wait(800)
      const before = where(view)
      await press('PageDown', 'PageDown', 34)
      const after = where(view)
      await press('PageUp', 'PageUp', 33)
      return { focused, before, after, back: where(view) }
    `)
    expect(r.error).toBeUndefined()
    expect(r.focused).toBe(true)
    expect(r.after).not.toBe(r.before)
    expect(r.back).toBe(r.before)
  })

  it('draws a highlight as lines, not a fill, and as before once it is off', () => {
    const r = run<{
      error?: string
      lines?: number
      fills?: number
      offLines?: number
      offFills?: number
    }>(`
      api.eink.set({ on: true })
      const { view } = await open(${JSON.stringify(RICH)})
      await view.engine.goTo(0)
      await wait(600)
      const doc = R(view).getContents()[0].doc
      const p = doc.getElementById('with-note')
      const range = doc.createRange()
      range.setStart(p.firstChild, 2)
      range.setEnd(p.firstChild, 7)
      doc.getSelection().removeAllRanges()
      doc.getSelection().addRange(range)
      await until(() => view.model.selection, 3000)
      await view.reading.highlight('green')
      await until(() => view.model.highlights.length === 1, 5000)
      await wait(500)
      const svg = () => R(view).getContents()[0].overlayer.element
      const lines = svg().querySelectorAll('line').length
      const fills = [...svg().querySelectorAll('g')].filter((g) => g.style.opacity).length
      await toggle()
      await wait(800)
      const offLines = svg().querySelectorAll('line').length
      const offFills = [...svg().querySelectorAll('g')].filter((g) => g.style.opacity).length
      const h = view.model.highlights[0]
      if (h) await view.reading.remove?.(h)
      return { lines, fills, offLines, offFills }
    `)
    expect(r.error).toBeUndefined()
    // Green is underlined twice.
    expect(r.lines).toBeGreaterThanOrEqual(2)
    expect(r.fills).toBe(0)
    expect(r.offLines).toBe(0)
    expect(r.offFills).toBeGreaterThan(0)
  })

  it('lays a PDF out a page at a time, and turns it on Page Down', () => {
    const r = run<{
      error?: string
      renderer?: string
      before?: string
      after?: string
    }>(`
      api.eink.set({ on: true })
      const { view } = await open(${JSON.stringify(PDF)})
      // Where an earlier run left it is kept: back to the first page.
      await view.engine.goTo(0)
      await until(() => /^Page 1 of/.test(view.model.chapter), 3000)
      view.takeFocus()
      const before = view.model.chapter
      await press('PageDown', 'PageDown', 34)
      await until(() => view.model.chapter !== before, 3000)
      return { renderer: R(view).localName, before, after: view.model.chapter }
    `)
    expect(r.error).toBeUndefined()
    expect(r.renderer).not.toContain('pdf-scroll')
    expect(r.before).toMatch(/^Page 1 of/)
    expect(r.after).toMatch(/^Page 2 of/)
  })

  it('on a phone, stays on after a reload, turns on a tap in the right third, and swipes still', async () => {
    run(`api.eink.set({ on: true }); return {}`)
    await reload('app.emulateMobile(true)')
    const r = run<{
      error?: string
      mobile?: boolean
      kept?: boolean
      tapped?: boolean
      during?: boolean
      lifted?: boolean
    }>(`
      const { view } = await open(${JSON.stringify(PROSE)})
      await view.engine.goTo(1)
      await wait(800)
      const kept = view.contentEl.classList.contains('abele-book_eink')
      const stage = view.contentEl.querySelector('.abele-book-reader__stage').getBoundingClientRect()
      const y = stage.top + stage.height / 2
      // Past the outer quarter, inside the right third.
      let from = where(view)
      await touch('touchStart', [[stage.left + stage.width * 0.7, y]])
      await wait(60)
      await touch('touchEnd')
      await wait(900)
      const tapped = where(view) !== from
      // A swipe to the left: the page stays put under the finger, and turns once it lifts.
      from = where(view)
      const start = R(view).start
      const x0 = stage.left + stage.width * 0.8
      await touch('touchStart', [[x0, y]])
      for (let i = 1; i <= 6; i++) { await touch('touchMove', [[x0 - i * 40, y]]); await wait(30) }
      const during = R(view).start === start
      await touch('touchEnd')
      await wait(900)
      return { mobile: app.isMobile, kept, tapped, during, lifted: where(view) !== from }
    `)
    expect(r.error).toBeUndefined()
    expect(r.mobile).toBe(true)
    expect(r.kept).toBe(true)
    expect(r.tapped).toBe(true)
    expect(r.during).toBe(true)
    expect(r.lifted).toBe(true)
    await reload('app.emulateMobile(false)')
  }, 180_000)
})
