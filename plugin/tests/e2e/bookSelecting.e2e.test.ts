/**
 * Selecting words on pages turned one at a time, in the running app: first with the mouse on the
 * desktop, then under `emulateMobile` at 390×844 with touches sent through the app's own input
 * pipeline (the DevTools protocol, from inside the app so a long press lasts as long as it says).
 *
 * Only a clean tap at the edge, or a swipe, turns the page. A long press, a finger held and then
 * moved, a tap while words are selected or on them, a tap on a highlight, a tap beside an open
 * bar (which closes it) and taps on the bars' own buttons leave it where it is. A selection held
 * at the edge turns the page and goes on growing on the next one — with the mouse, with a finger
 * whose moves the page hears, and with only the selection's end to go by, as iOS's handles give —
 * and is highlighted as one; it stops at the end of its chapter, and in a PDF at its page, and
 * says so. Pictures go to `/tmp/abele-phone/select-*.png`.
 *
 * What cannot be checked here: iOS's own selection handles and long press inside a page's frame,
 * which WebKit runs itself. The touches here make the gestures; the selection a long press or a
 * handle would make is set by the test as the finger moves.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw, evalJson, runCli } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildRichEpub } from '../fixtures/books/richBook'
import { buildPlainPdf } from '../fixtures/books/pdfFixture'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader selecting e2e'
const BOOK = `${DIR}/rich.epub`
const PDF = `${DIR}/plain.pdf`
const NOTE = `${DIR}/rich highlights.md`
const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 800 }
const SHOTS = '/tmp/abele-phone'

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const windowSize = (): [number, number] =>
  evalJson<[number, number]>(`require('@electron/remote').getCurrentWindow().getContentSize()`)
const setWindowSize = async (width: number, height: number): Promise<void> => {
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
    30_000
  )
  await pause(1500)
}
/**
 * The app's DevTools debugger, which the touches and clicks here are sent through, attached the
 * way the CLI attaches it: after a fresh start of the app nothing has, and input sent through it
 * goes nowhere.
 */
const attachDebugger = (): void => void runCli(['dev:debug', 'on'], 30_000)

const reload = async (how: string): Promise<void> => {
  evalRaw(`(() => { setTimeout(() => { ${how} }, 50); return 'ok' })()`, 30_000)
  await pause(4000)
  const deadline = Date.now() + 60_000
  while (!hasTestApi() && Date.now() < deadline) await pause(1000)
  attachDebugger()
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWebContents().setBackgroundThrottling(false); return 'ok' })()`
  )
}

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 8000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(50) }
    return null
  }
  const cdp = require('@electron/remote').getCurrentWebContents().debugger
  const touch = (type, x, y) =>
    cdp.sendCommand('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y) }] })
  const mouse = (type, x, y, buttons = 1) =>
    cdp.sendCommand('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: 1 })
  const tap = async (x, y, hold = 60) => { await touch('touchStart', x, y); await wait(hold); await touch('touchEnd'); await wait(700) }
  const swipe = async (x0, x1, y, hold = 0) => {
    await touch('touchStart', x0, y); await wait(hold)
    for (let i = 1; i <= 6; i++) { await touch('touchMove', x0 + (x1 - x0) * i / 6, y); await wait(16) }
    await touch('touchEnd'); await wait(900)
  }
  const open = async (path) => {
    // A new tab, or the one Obsidian keeps when there is no tab group to put one in.
    let leaf
    try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.getLeaf(false) }
    await leaf.setViewState({ type: 'abele-book', state: { file: path }, active: true })
    await until(() => leaf.view?.model?.status === 'ready' && leaf.view.reading, 15000)
    const view = leaf.view
    await wait(500)
    return { leaf, view }
  }
  const R = (view) => view.engine.renderer
  const docOf = (view) => R(view).getContents()[0].doc
  const box = (view) => R(view).getBoundingClientRect()
  /** Chapter 1, its second page, nothing selected and no bar open. */
  const fresh = async (view) => {
    // The contents panel, which the desktop remembers open, would stand over the page.
    if (view.model.panel) { view.model.panel = false; await wait(400) }
    view.reading.clearSelection(); view.model.active = null
    await view.engine.goTo(view.model.toc[0].href); await wait(500)
    await R(view).next(); await wait(700)
    view.reading.clearSelection(); view.model.active = null
    await wait(300)
  }
  /** Where a word on the page on screen is, in the window: its range and its box. */
  const words = (view) => {
    const doc = docOf(view)
    const frame = doc.defaultView.frameElement.getBoundingClientRect()
    const s = box(view)
    const out = []
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const re = /\\S+/g
      let m
      while ((m = re.exec(n.nodeValue))) {
        const range = doc.createRange(); range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length)
        const r = range.getBoundingClientRect()
        const x = r.left + frame.left, y = r.top + frame.top
        if (r.width && x >= s.left && x + r.width <= s.right && y >= s.top && y + r.height <= s.bottom)
          out.push({ range, x: x + r.width / 2, y: y + r.height / 2, left: x, right: x + r.width })
      }
    }
    return out
  }
  const select = (view, range) => {
    const sel = docOf(view).getSelection()
    sel.removeAllRanges(); sel.addRange(range)
  }
  /** Where a point in the window falls in the page's text. */
  const caretAt = (view, x, y) => {
    const doc = docOf(view)
    const frame = doc.defaultView.frameElement.getBoundingClientRect()
    return doc.caretRangeFromPoint(x - frame.left, y - frame.top)
  }
  /** Whether a word is wholly on screen still. */
  const shown = (view, range) =>
    words(view).some((w) => w.range.compareBoundaryPoints(Range.START_TO_START, range) === 0)
  /** Where the engine's view is: scrolled for now or in pages, and how far along. */
  const at = (view) => ({ scrolled: R(view).scrolled, start: R(view).start, size: R(view).size, page: R(view).page })
  const notices = () => [...document.querySelectorAll('.notice')].map((n) => n.textContent)
  const shoot = async (name) => {
    const img = await Promise.race([require('@electron/remote').getCurrentWebContents().capturePage(), wait(8000).then(() => null)])
    if (img) { require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true }); require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/select-' + name + '.png', img.toPNG()) }
  }
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    120_000
  )

describe.skipIf(!available)('selecting words on pages turned one at a time', () => {
  let savedReader: unknown = null
  let size: [number, number] = [0, 0]

  beforeAll(() => {
    attachDebugger()
    const files = {
      'rich.epub': Buffer.from(buildRichEpub()).toString('base64'),
      'plain.pdf': Buffer.from(buildPlainPdf()).toString('base64'),
    }
    savedReader = evalJson<unknown>('window.__abeleTest.AbeleConfig.getInstance().reader')
    size = windowSize()
    evalRaw(
      `(async () => {
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        for (const [name, data] of Object.entries(${JSON.stringify(files)})) {
          const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
          await app.vault.createBinary(${JSON.stringify(DIR)} + '/' + name, bytes.buffer)
        }
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = { ...cfg.reader, flow: 'paginated', pdfLayout: 'paginated' }
        await cfg.saveSettings()
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  afterAll(async () => {
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = ${JSON.stringify(savedReader)}
        await cfg.saveSettings()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        return 'ok'
      })()`,
      60_000
    )
    // Back to the desktop first, then the size: leaving phone emulation keeps the phone's size.
    if (evalJson<boolean>('app.isMobile')) await reload('app.emulateMobile(false)')
    if (size[0]) await setWindowSize(size[0], size[1])
  }, 180_000)

  describe('with the mouse, on the desktop', () => {
    // Two columns side by side, as these steps assume: a window as wide as the tests were written
    // for, whatever the file before left, and neither side panel narrowing the tab.
    let panels: [boolean, boolean] = [true, true]
    beforeAll(async () => {
      await setWindowSize(DESKTOP.width, DESKTOP.height)
      panels = evalJson<[boolean, boolean]>(
        `(() => { const w = app.workspace, was = [w.leftSplit.collapsed, w.rightSplit.collapsed]; w.leftSplit.collapse(); w.rightSplit.collapse(); return was })()`
      )
      await pause(800)
    }, 60_000)
    afterAll(() => {
      evalRaw(
        `(() => { const w = app.workspace; if (!${panels[0]}) w.leftSplit.expand(); if (!${panels[1]}) w.rightSplit.expand(); return 'ok' })()`
      )
    })

    it('a click at the edge turns the page; with words selected only one on the very edge moves it, by a column', () => {
      const r = run<{
        error?: string
        clicked?: number[]
        withSelection?: number[]
        atEdge?: number
        step?: number
        size?: number
        kept?: boolean
        still?: boolean
      }>(`
        const { leaf, view } = await open(${JSON.stringify(BOOK)})
        await fresh(view)
        // On the page's own text near its right edge: the margins beside the columns on a wide
        // desktop tab are the engine's, not the page's.
        const edge = words(view).reduce((a, b) => (b.right > a.right ? b : a))
        const y = edge.y
        const click = async (x) => { await mouse('mouseMoved', x, y, 0); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y, 0); await wait(600) }
        const p0 = R(view).page
        await click(edge.right - 2)
        const clicked = [p0, R(view).page]
        const w = words(view)[5]
        select(view, w.range); await wait(700)
        const p1 = R(view).page
        // Two thirds across: a clean click there turns; with words selected, only the very edge.
        const s = box(view)
        await click(s.left + s.width * 0.8)
        const withSelection = [p1, R(view).page]
        // That click let the words go, as a click beside a selection does: selected again.
        // A word of the right-hand column, as words reaching for the edge are.
        const chosen = words(view).filter((w) => w.x > s.left + s.width / 2)[3].range
        select(view, chosen); await wait(700)
        const s2 = at(view)
        await click(s.right - 4)
        await wait(300)
        // Half a page on: of two columns, one — the words just selected still on screen.
        const step = at(view).start - s2.start
        const still = shown(view, chosen)
        const kept = !docOf(view).getSelection().isCollapsed
        view.reading.clearSelection()
        leaf.detach()
        return { clicked, withSelection, step, size: s2.size, kept, still }
      `)
      expect(r.error).toBeUndefined()
      expect(r.clicked![1]).toBe(r.clicked![0] + 1)
      expect(r.withSelection![1]).toBe(r.withSelection![0])
      expect(Math.abs(r.step! - r.size! / 2)).toBeLessThan(2)
      expect(r.kept).toBe(true)
      expect(r.still).toBe(true)
    })

    it('a selection dragged to the edge moves the pages on by a column, grows onto what comes, and is highlighted as one', () => {
      const r = run<{
        error?: string
        pages?: number[]
        spans?: boolean
        first?: string
        text?: string
        note?: string
        step?: number
        size?: number
        aligned?: boolean
      }>(`
        const { leaf, view } = await open(${JSON.stringify(BOOK)})
        await fresh(view)
        const s = box(view)
        const s0 = at(view)
        const visible = view.engine.lastLocation.range
        const list = words(view)
        const start = list[Math.floor(list.length / 2)]
        const p0 = R(view).page
        await mouse('mouseMoved', start.left + 1, start.y, 0)
        await mouse('mousePressed', start.left + 1, start.y)
        for (const t of [0.5, 1]) { await mouse('mouseMoved', start.x + (s.right - 3 - start.x) * t, start.y); await wait(60) }
        // Held at the edge until the pages move on, the pointer never quite still.
        await until(async () => { await mouse('mouseMoved', s.right - 3 - (Date.now() % 2), start.y); return R(view).start !== s0.start }, 3000)
        // On into the column that came: the next page's first.
        await mouse('mouseMoved', s.left + s.width * 0.7, s.top + s.height * 0.3); await wait(500)
        const step = at(view).start - s0.start
        await mouse('mouseReleased', s.left + s.width * 0.7, s.top + s.height * 0.3, 0)
        await wait(500)
        const sel = docOf(view).getSelection()
        const range = sel.getRangeAt(0)
        const spans = visible.comparePoint(range.endContainer, range.endOffset) > 0
        await until(() => view.model.selection, 3000)
        const text = view.model.selection?.text ?? ''
        await view.reading.highlight('yellow')
        const file = await until(() => app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}), 5000)
        const note = file ? await app.vault.read(file) : ''
        // Let go — highlighted — the pages come back to rest on a page's edge.
        await wait(800)
        const aligned = Math.abs(R(view).start / R(view).size - Math.round(R(view).start / R(view).size)) < 0.01
        const pEnd = R(view).page
        leaf.detach()
        return { pages: [p0, pEnd], spans, first: start.range.toString(), text, note, step, size: s0.size, aligned }
      `)
      expect(r.error).toBeUndefined()
      expect(Math.abs(r.step! - r.size! / 2)).toBeLessThan(2)
      expect(r.aligned).toBe(true)
      expect(r.spans).toBe(true)
      expect(r.text!.startsWith(r.first!)).toBe(true)
      // The highlight is one callout holding the words of both pages.
      expect(r.note).toContain('> [!quote|yellow]')
      // The words of both pages, the last of them as the note quotes them.
      expect(r.note!.replace(/\s+/g, ' ')).toContain(r.text!.split('\n').pop()!.trim().slice(-30))
    })

    it('letting go of the mouse at the edge after selecting words leaves the page where it is', () => {
      const r = run<{
        error?: string
        before?: unknown
        after?: unknown
        text?: string
        kept?: boolean
      }>(`
        const { leaf, view } = await open(${JSON.stringify(BOOK)})
        await fresh(view)
        const s = box(view)
        const list = words(view).filter((w) => w.x > s.left + s.width / 2)
        const start = list[Math.floor(list.length / 2)]
        const before = at(view)
        // A drag across the line to the very edge, let go there before a hold could move anything.
        await mouse('mouseMoved', start.left + 1, start.y, 0)
        await mouse('mousePressed', start.left + 1, start.y)
        for (const t of [0.34, 0.67, 1]) { await mouse('mouseMoved', start.x + (s.right - 3 - start.x) * t, start.y); await wait(30) }
        await mouse('mouseReleased', s.right - 3, start.y, 0)
        await wait(1200)
        const after = at(view)
        const text = docOf(view).getSelection().toString()
        const kept = !docOf(view).getSelection().isCollapsed
        view.reading.clearSelection()
        leaf.detach()
        return { before, after, text, kept }
      `)
      expect(r.error).toBeUndefined()
      expect(r.kept).toBe(true)
      expect(r.text!.length).toBeGreaterThan(0)
      expect(r.after).toEqual(r.before)
    })

    it('in a chapter scrolled by the reader’s own choice, words selected move it half a screen', () => {
      const r = run<{ error?: string; step?: number; size?: number; still?: boolean }>(`
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = { ...cfg.reader, flow: 'scrolled' }
        await cfg.saveSettings()
        try {
          const { leaf, view } = await open(${JSON.stringify(BOOK)})
          if (view.model.panel) { view.model.panel = false; await wait(400) }
          await until(() => R(view).scrolled, 3000)
          // At the chapter's start, wherever the tests before left the book: at its end there is
          // no half screen further to go.
          await view.engine.goTo(view.model.toc[0].href)
          await wait(500)
          const s = box(view)
          const list = words(view)
          const chosen = list[list.length - 2]
          select(view, chosen.range)
          await until(() => view.model.selection, 3000)
          await wait(700)
          const s0 = at(view)
          // On the page's edge, not on the scrolled chapter's scrollbar beside it: a click on its
          // track is the platform's own page down, a screen less 40 px, and never reaches the page.
          const x = s.right - s.width * 0.08, y = s.top + s.height / 2
          await mouse('mouseMoved', x, y, 0); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y, 0)
          await wait(900)
          const step = at(view).start - s0.start
          const still = shown(view, chosen.range)
          view.reading.clearSelection()
          leaf.detach()
          return { step, size: s0.size, still }
        } finally {
          cfg.reader = { ...cfg.reader, flow: 'paginated' }
          await cfg.saveSettings()
        }
      `)
      expect(r.error).toBeUndefined()
      expect(Math.abs(r.step! - r.size! / 2)).toBeLessThan(2)
      expect(r.still).toBe(true)
    })

    it('stays on its page of a PDF, and says why', () => {
      const r = run<{ error?: string; pages?: number[]; told?: string[] }>(`
        const { leaf, view } = await open(${JSON.stringify(PDF)})
        // The contents panel, which the desktop remembers open, would stand over the page.
        if (view.model.panel) { view.model.panel = false; await wait(400) }
        await view.engine.goTo(0)
        await until(() => docOf(view)?.querySelector('.textLayer span'), 8000)
        await wait(400)
        const doc = docOf(view)
        const span = doc.querySelector('.textLayer span')
        const frame = doc.defaultView.frameElement.getBoundingClientRect()
        const sr = span.getBoundingClientRect()
        const s = box(view)
        const x = frame.left + sr.left + 2, y = frame.top + sr.top + sr.height / 2
        const p0 = R(view).index
        await mouse('mouseMoved', x, y, 0); await mouse('mousePressed', x, y)
        await mouse('mouseMoved', x + 40, y)
        // Held until the app has answered, not for a fixed time: the answer comes from a timer
        // in the app, and a stall there (a collection on a full heap) let the release land first
        // and take the hold away, so the notice never came.
        const deadline = Date.now() + 5000
        while (Date.now() < deadline && !notices().some((t) => /own page/.test(t))) {
          await mouse('mouseMoved', s.right - 3 - (Date.now() % 2), y); await wait(80)
        }
        await mouse('mouseReleased', s.right - 3, y, 0)
        await wait(300)
        const told = notices()
        view.reading.clearSelection()
        const pEnd = R(view).index
        leaf.detach()
        return { pages: [p0, pEnd], told }
      `)
      expect(r.error).toBeUndefined()
      expect(r.pages![1]).toBe(r.pages![0])
      expect(r.told!.some((t) => /own page/.test(t))).toBe(true)
    })
  })

  describe('with a finger, on a phone', () => {
    beforeAll(async () => {
      await reload('app.emulateMobile(true)')
      await setWindowSize(PHONE.width, PHONE.height)
      await reload('window.location.reload()')
    }, 180_000)

    it('a clean tap at either edge, or a swipe, turns the page', () => {
      const r = run<{ error?: string; right?: number[]; left?: number[]; swipe?: number[] }>(`
        const { leaf, view } = await open(${JSON.stringify(BOOK)})
        await fresh(view)
        const s = box(view), y = s.top + s.height / 2
        const p0 = R(view).page
        await tap(s.right - 15, y)
        const right = [p0, R(view).page]
        await tap(s.left + 15, y)
        const left = [right[1], R(view).page]
        await swipe(s.right - 60, s.left + 60, y)
        const swiped = [left[1], R(view).page]
        leaf.detach()
        return { right, left, swipe: swiped }
      `)
      expect(r.error).toBeUndefined()
      expect(r.right![1]).toBe(r.right![0] + 1)
      expect(r.left![1]).toBe(r.left![0] - 1)
      expect(r.swipe![1]).toBe(r.swipe![0] + 1)
    })

    it('a long press, a finger held and then moved, and a swipe over a selection turn nothing', () => {
      const r = run<{ error?: string; pages?: number[] }>(`
        const { leaf, view } = await open(${JSON.stringify(BOOK)})
        await fresh(view)
        const s = box(view), y = s.top + s.height / 2
        const p0 = R(view).page
        await tap(s.right - 15, y, 800)
        await swipe(s.right - 60, s.left + 60, y, 700)
        select(view, words(view)[4].range); await wait(400)
        await swipe(s.right - 60, s.left + 60, y + 60)
        const p1 = R(view).page
        view.reading.clearSelection()
        leaf.detach()
        return { pages: [p0, p1] }
      `)
      expect(r.error).toBeUndefined()
      expect(r.pages![1]).toBe(r.pages![0])
    })

    it('taps while words are selected, on the selection and on its bar turn nothing', () => {
      const r = run<{ error?: string; pages?: number[]; bar?: boolean; madeHighlight?: boolean }>(`
        const { leaf, view } = await open(${JSON.stringify(BOOK)})
        await fresh(view)
        const s = box(view), y = s.top + s.height / 2
        const p0 = R(view).page
        const list = words(view)
        // A word in the right edge's zone, where a clean tap would turn the page, short of the very
        // edge, where a tap with words selected carries them on to the next page.
        const edgeWord =
          list.find((w) => w.x > s.left + s.width * 0.76 && w.x < s.left + s.width * 0.84) ??
          list[list.length - 1]
        select(view, edgeWord.range)
        await until(() => view.model.selection, 3000)
        await tap(edgeWord.x, edgeWord.y)
        select(view, list[3].range)
        await until(() => view.model.selection?.text === list[3].range.toString(), 3000)
        // Once the words have rested: the bar stays hidden while they are being selected.
        const bar = !!(await until(() => !view.model.selecting && view.contentEl.querySelector('.abele-book-selection'), 3000))
        await shoot('phone-selection-bar')
        // The bar's own buttons: a colour highlights, and nothing turns.
        const swatch = view.contentEl.querySelector('.abele-book-selection__swatch').getBoundingClientRect()
        await tap(swatch.left + swatch.width / 2, swatch.top + swatch.height / 2)
        const madeHighlight = !!(await until(() => view.model.highlights.length, 4000))
        const p1 = R(view).page
        leaf.detach()
        return { pages: [p0, p1], bar, madeHighlight }
      `)
      expect(r.error).toBeUndefined()
      expect(r.bar).toBe(true)
      expect(r.madeHighlight).toBe(true)
      expect(r.pages![1]).toBe(r.pages![0])
    })

    it('a tap on a highlight opens its bar, its buttons and a tap beside it turn nothing, and the next tap does', () => {
      const r = run<{
        error?: string
        opened?: boolean
        afterButton?: boolean
        closed?: boolean
        pages?: number[]
        turned?: number
      }>(`
        const { leaf, view } = await open(${JSON.stringify(BOOK)})
        await fresh(view)
        const s = box(view), y = s.top + s.height / 2
        const list = words(view)
        const edgeWord = [...list].reverse().find((w) => w.left > s.left + s.width * 0.78 && w.y < y) ?? list[list.length - 2]
        select(view, edgeWord.range)
        await until(() => view.model.selection, 3000)
        await view.reading.highlight('green')
        await wait(800)
        const p0 = R(view).page
        await tap(edgeWord.x, edgeWord.y)
        const opened = !!(await until(() => view.model.active, 3000))
        await shoot('phone-highlight-bar')
        // A button of the highlight's bar: another colour.
        const swatches = [...view.contentEl.querySelectorAll('.abele-book-selection__swatch')]
        const other = swatches[2].getBoundingClientRect()
        await tap(other.left + other.width / 2, other.top + other.height / 2)
        const afterButton = !!view.model.active
        await tap(s.right - 15, y + 100)
        const closed = !view.model.active
        const p1 = R(view).page
        await tap(s.right - 15, y + 100)
        const turned = R(view).page
        leaf.detach()
        return { opened, afterButton, closed, pages: [p0, p1], turned }
      `)
      expect(r.error).toBeUndefined()
      expect(r.opened).toBe(true)
      expect(r.afterButton).toBe(true)
      expect(r.closed).toBe(true)
      expect(r.pages![1]).toBe(r.pages![0])
      expect(r.turned).toBe(r.pages![0] + 1)
    })

    it('a selection’s end dragged to the edge moves the page on by half, and grows onto what comes', () => {
      const r = run<{
        error?: string
        moved?: boolean
        still?: boolean
        spans?: boolean
        text?: string
        first?: string
        settled?: boolean
        endShown?: boolean
      }>(`
        const { leaf, view } = await open(${JSON.stringify(BOOK)})
        await fresh(view)
        const s = box(view)
        const visible = view.engine.lastLocation.range
        const list = words(view)
        const first = list[Math.floor(list.length / 3)]
        // What a long press would select, then its end handle dragged by the finger.
        select(view, first.range)
        await until(() => view.model.selection, 3000)
        const sel = docOf(view).getSelection()
        const extendTo = (x, y) => {
          const c = caretAt(view, Math.min(x, s.right - 2), y)
          if (c) sel.setBaseAndExtent(first.range.startContainer, first.range.startOffset, c.startContainer, c.startOffset)
        }
        const s0 = at(view)
        const yLow = s.top + s.height * 0.8
        await touch('touchStart', first.right, first.y)
        for (let i = 1; i <= 5; i++) {
          const x = first.right + (s.right - 4 - first.right) * i / 5, yy = first.y + (yLow - first.y) * i / 5
          await touch('touchMove', x, yy); extendTo(x, yy); await wait(40)
        }
        // The last word selected before the page moved on.
        const tail = list.filter((w) => sel.getRangeAt(0).isPointInRange(w.range.endContainer, w.range.endOffset)).pop()
        const moved = !!(await until(async () => { await touch('touchMove', s.right - 4 - (Date.now() % 2), yLow); return R(view).scrolled }, 3000))
        await wait(500)
        // Half a page on, scrolled for now: the words last selected still on screen.
        const still = !!tail && shown(view, tail.range)
        const low = words(view).filter((w) => w.y > s.top + s.height * 0.75)
        const further = low[Math.floor(low.length / 2)]
        await touch('touchMove', further.x, further.y)
        sel.setBaseAndExtent(first.range.startContainer, first.range.startOffset, further.range.endContainer, further.range.endOffset)
        await wait(100)
        await touch('touchEnd')
        await wait(600)
        const range = sel.getRangeAt(0)
        const spans = visible.comparePoint(range.endContainer, range.endOffset) > 0
        await until(() => view.model.selection && !view.model.selecting, 3000)
        await shoot('phone-across-pages')
        const text = view.model.selection?.text ?? ''
        const end = [range.endContainer, range.endOffset]
        view.reading.clearSelection()
        // Let go: pages again, on the one where the selection ended.
        const settled = !!(await until(() => !R(view).scrolled, 3000))
        await wait(300)
        const endShown = view.engine.lastLocation.range.comparePoint(end[0], end[1]) === 0
        await shoot('phone-settled')
        leaf.detach()
        return { moved, still, spans, text, first: first.range.toString(), settled, endShown }
      `)
      expect(r.error).toBeUndefined()
      expect(r).toMatchObject({
        moved: true,
        still: true,
        spans: true,
        settled: true,
        endShown: true,
      })
      expect(r.text!.startsWith(r.first!)).toBe(true)
    })

    it('while words are being selected their bar is hidden, and comes back once they have rested', () => {
      const r = run<{ error?: string; during?: boolean[]; after?: boolean }>(`
        const { leaf, view } = await open(${JSON.stringify(BOOK)})
        await fresh(view)
        const list = words(view)
        const first = list[Math.floor(list.length / 3)]
        const sel = docOf(view).getSelection()
        const bar = () => !!view.contentEl.querySelector('.abele-book-selection')
        // A handle dragged down the page, the way WebKit moves the selection under it.
        const during = []
        for (let i = 1; i <= 6; i++) {
          const w = list[Math.floor(list.length / 3) + i * 3]
          sel.setBaseAndExtent(first.range.startContainer, first.range.startOffset, w.range.endContainer, w.range.endOffset)
          await wait(150)
          during.push(bar())
        }
        await shoot('phone-selecting')
        const after = !!(await until(bar, 3000))
        view.reading.clearSelection()
        leaf.detach()
        return { during, after }
      `)
      expect(r.error).toBeUndefined()
      expect(r.during).toEqual([false, false, false, false, false, false])
      expect(r.after).toBe(true)
    })

    it('with words selected, a tap on the very edge moves the page on by half, and back', () => {
      const r = run<{
        error?: string
        moved?: boolean
        step?: number
        size?: number
        still?: boolean
        back?: number
        kept?: boolean
      }>(`
        const { leaf, view } = await open(${JSON.stringify(BOOK)})
        await fresh(view)
        const s = box(view), y = s.top + s.height / 2
        const list = words(view)
        const chosen = list[list.length - 3]
        select(view, chosen.range)
        await until(() => view.model.selection, 3000)
        await wait(700)
        await tap(s.right - 10, y)
        await wait(400)
        const a1 = at(view)
        const still = shown(view, chosen.range)
        const sel = docOf(view).getSelection()
        await until(() => view.model.selection && !view.model.selecting, 3000)
        await wait(300)
        await shoot('phone-edge-tap')
        await tap(s.right - 10, y)
        await wait(400)
        const step = at(view).start - a1.start
        await tap(s.left + 10, y)
        await wait(400)
        const back = at(view).start - a1.start
        const kept = !sel.isCollapsed && sel.toString().startsWith(chosen.range.toString())
        view.reading.clearSelection()
        leaf.detach()
        return { moved: a1.scrolled, step, size: a1.size, still, back, kept }
      `)
      expect(r.error).toBeUndefined()
      // Pages of one column cannot move by half without cutting every line: scrolled for now.
      expect(r.moved).toBe(true)
      expect(r.still).toBe(true)
      expect(Math.abs(r.step! - r.size! / 2)).toBeLessThan(2)
      expect(Math.abs(r.back!)).toBeLessThan(2)
      expect(r.kept).toBe(true)
    })

    it('with no finger to follow, as under iOS’s handles, an end brought to the foot and held moves the page on by half, the top left free', () => {
      const r = run<{
        error?: string
        moved?: boolean
        still?: boolean
        barDuring?: boolean
        grown?: boolean
      }>(`
        const { leaf, view } = await open(${JSON.stringify(BOOK)})
        await fresh(view)
        const list = words(view)
        const first = list[Math.floor(list.length / 2)]
        const last = list[list.length - 1]
        const sel = docOf(view).getSelection()
        select(view, first.range)
        await wait(300)
        // Dragged down to the foot of the page, and held there.
        const mid = list[Math.floor(list.length * 0.75)]
        sel.setBaseAndExtent(first.range.startContainer, first.range.startOffset, mid.range.endContainer, mid.range.endOffset)
        await wait(150)
        sel.setBaseAndExtent(first.range.startContainer, first.range.startOffset, last.range.endContainer, last.range.endOffset)
        const moved = !!(await until(() => R(view).scrolled, 3000))
        await wait(400)
        const barDuring = !!view.contentEl.querySelector('.abele-book-selection')
        const still = shown(view, last.range)
        await shoot('phone-held-at-foot')
        // Taken on down the screen.
        const onScreen = words(view)
        const further = onScreen[onScreen.length - 3]
        sel.setBaseAndExtent(first.range.startContainer, first.range.startOffset, further.range.endContainer, further.range.endOffset)
        await wait(300)
        const grown = sel.toString().trim().endsWith(further.range.toString())
        view.reading.clearSelection()
        leaf.detach()
        return { moved, still, barDuring, grown }
      `)
      expect(r.error).toBeUndefined()
      expect(r.moved).toBe(true)
      expect(r.still).toBe(true)
      expect(r.barDuring).toBe(false)
      expect(r.grown).toBe(true)
    })

    it('the bar takes the place of the line with the slider: no word covered, the page not laid out anew', () => {
      const r = run<{
        error?: string
        stage?: number[]
        withBar?: number[]
        bar?: number[]
        footerGone?: boolean
        footer?: number[]
        speech?: number[]
      }>(`
        const { leaf, view } = await open(${JSON.stringify(BOOK)})
        await fresh(view)
        const rect = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom)] }
        const stageEl = view.contentEl.querySelector('.abele-book-reader__stage')
        const stage = rect(stageEl)
        const footer = rect(view.contentEl.querySelector('.abele-book-reader__footer'))
        await shoot('phone-footer')
        const list = words(view)
        select(view, list[list.length - 1].range)
        await until(() => view.model.selection && !view.model.selecting && view.contentEl.querySelector('.abele-book-selection'), 3000)
        await wait(200)
        const bar = rect(view.contentEl.querySelector('.abele-book-selection'))
        const withBar = rect(stageEl)
        const footerGone = !view.contentEl.querySelector('.abele-book-reader__footer')
        await shoot('phone-bar')
        view.reading.clearSelection()
        await until(() => !view.contentEl.querySelector('.abele-book-selection'), 3000)
        view.model.speech = 'paused'
        await wait(200)
        const speech = rect(view.contentEl.querySelector('.abele-book-speech'))
        await shoot('phone-speech-bar')
        view.model.speech = 'idle'
        leaf.detach()
        return { stage, withBar, bar, footerGone, footer, speech }
      `)
      expect(r.error).toBeUndefined()
      // In the row under the page, not over it, and the page just as tall.
      expect(r.bar![0]).toBeGreaterThanOrEqual(r.stage![1] - 1)
      expect(r.withBar).toEqual(r.stage)
      expect(r.footerGone).toBe(true)
      // The three are one row, as tall as each other.
      expect(r.bar).toEqual(r.footer)
      expect(r.speech).toEqual(r.footer)
    })

    it('stops at the end of the chapter, and says so', () => {
      const r = run<{
        error?: string
        before?: [number, string]
        after?: [number, string]
        told?: string[]
      }>(`
        const { leaf, view } = await open(${JSON.stringify(BOOK)})
        await fresh(view)
        for (let i = 0; i < 40 && R(view).page < R(view).pages - 2; i++) { await R(view).next(); await wait(150) }
        await wait(500)
        const s = box(view)
        const list = words(view)
        const w = list[Math.floor(list.length / 2)]
        select(view, w.range)
        await wait(300)
        const before = [R(view).page, view.model.chapter]
        await touch('touchStart', w.right, w.y)
        await touch('touchMove', s.right - 20, w.y)
        const deadline = Date.now() + 1800
        while (Date.now() < deadline) { await touch('touchMove', s.right - 4 - (Date.now() % 2), w.y); await wait(80) }
        await touch('touchEnd')
        await wait(400)
        const told = notices()
        const after = [R(view).page, view.model.chapter]
        view.reading.clearSelection()
        leaf.detach()
        return { before, after, told }
      `)
      expect(r.error).toBeUndefined()
      expect(r.after).toEqual(r.before)
      expect(r.told!.some((t) => /end of the chapter/.test(t))).toBe(true)
    })
  })
})
