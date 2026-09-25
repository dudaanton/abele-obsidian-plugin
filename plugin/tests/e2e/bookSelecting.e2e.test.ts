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
    if (evalJson<boolean>('app.isMobile')) {
      if (size[0]) await setWindowSize(size[0], size[1])
      await reload('app.emulateMobile(false)')
    }
  }, 180_000)

  describe('with the mouse, on the desktop', () => {
    it('a click at the edge turns the page, one that lets a selection go does not', () => {
      const r = run<{ error?: string; clicked?: number[]; withSelection?: number[] }>(`
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
        select(view, w.range); await wait(400)
        const p1 = R(view).page
        await click(edge.right - 2)
        const withSelection = [p1, R(view).page]
        leaf.detach()
        return { clicked, withSelection }
      `)
      expect(r.error).toBeUndefined()
      expect(r.clicked![1]).toBe(r.clicked![0] + 1)
      expect(r.withSelection![1]).toBe(r.withSelection![0])
    })

    it('a selection dragged to the edge turns the page, grows onto the next, and is highlighted as one', () => {
      const r = run<{
        error?: string
        pages?: number[]
        spans?: boolean
        first?: string
        text?: string
        note?: string
      }>(`
        const { leaf, view } = await open(${JSON.stringify(BOOK)})
        await fresh(view)
        const s = box(view)
        const visible = view.engine.lastLocation.range
        const list = words(view)
        const start = list[Math.floor(list.length / 2)]
        const p0 = R(view).page
        await mouse('mouseMoved', start.left + 1, start.y, 0)
        await mouse('mousePressed', start.left + 1, start.y)
        for (const t of [0.5, 1]) { await mouse('mouseMoved', start.x + (s.right - 3 - start.x) * t, start.y); await wait(60) }
        // Held at the edge until the page turns, the pointer never quite still.
        await until(async () => { await mouse('mouseMoved', s.right - 3 - (Date.now() % 2), start.y); return R(view).page !== p0 }, 3000)
        const p1 = R(view).page
        await mouse('mouseMoved', s.left + s.width * 0.3, s.top + s.height * 0.3); await wait(100)
        await mouse('mouseReleased', s.left + s.width * 0.3, s.top + s.height * 0.3, 0)
        await wait(500)
        const sel = docOf(view).getSelection()
        const range = sel.getRangeAt(0)
        const spans = visible.comparePoint(range.endContainer, range.endOffset) > 0
        await until(() => view.model.selection, 3000)
        const text = view.model.selection?.text ?? ''
        await view.reading.highlight('yellow')
        const file = await until(() => app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}), 5000)
        const note = file ? await app.vault.read(file) : ''
        const pEnd = R(view).page
        leaf.detach()
        return { pages: [p0, p1, pEnd], spans, first: start.range.toString(), text, note }
      `)
      expect(r.error).toBeUndefined()
      expect(r.pages![1]).toBe(r.pages![0] + 1)
      expect(r.spans).toBe(true)
      expect(r.text!.startsWith(r.first!)).toBe(true)
      // The highlight is one callout holding the words of both pages.
      expect(r.note).toContain('> [!quote|yellow]')
      expect(r.note!.replace(/\s+/g, ' ')).toContain(r.text!.replace(/\s+/g, ' ').slice(-40))
    })

    it('stays on its page of a PDF, and says why', () => {
      const r = run<{ error?: string; pages?: number[]; told?: string[] }>(`
        const { leaf, view } = await open(${JSON.stringify(PDF)})
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
        const deadline = Date.now() + 1500
        while (Date.now() < deadline) { await mouse('mouseMoved', s.right - 3 - (Date.now() % 2), y); await wait(80) }
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
        // A word in the right edge's zone, where a clean tap would turn the page.
        const edgeWord = list.find((w) => w.left > s.left + s.width * 0.78) ?? list[list.length - 1]
        select(view, edgeWord.range)
        await until(() => view.model.selection, 3000)
        await tap(edgeWord.x, edgeWord.y)
        select(view, edgeWord.range)
        await until(() => view.model.selection, 3000)
        await tap(s.right - 15, y + 80)
        select(view, list[3].range)
        await until(() => view.model.selection, 3000)
        const bar = !!(await until(() => view.contentEl.querySelector('.abele-book-selection'), 3000))
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

    it('a selection’s end dragged to the edge turns the page and grows onto the next', () => {
      const r = run<{
        error?: string
        pages?: number[]
        spans?: boolean
        text?: string
        first?: string
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
        const p0 = R(view).page
        const yLow = s.top + s.height * 0.8
        await touch('touchStart', first.right, first.y)
        for (let i = 1; i <= 5; i++) {
          const x = first.right + (s.right - 4 - first.right) * i / 5, yy = first.y + (yLow - first.y) * i / 5
          await touch('touchMove', x, yy); extendTo(x, yy); await wait(40)
        }
        await until(async () => { await touch('touchMove', s.right - 4 - (Date.now() % 2), yLow); return R(view).page !== p0 }, 3000)
        const p1 = R(view).page
        await touch('touchMove', s.left + s.width / 2, s.top + s.height * 0.3)
        extendTo(s.left + s.width / 2, s.top + s.height * 0.3)
        await wait(100)
        await touch('touchEnd')
        await wait(600)
        const range = sel.getRangeAt(0)
        const spans = visible.comparePoint(range.endContainer, range.endOffset) > 0
        await until(() => view.model.selection?.text?.length > first.range.toString().length + 200, 3000)
        await shoot('phone-across-pages')
        const text = view.model.selection?.text ?? ''
        view.reading.clearSelection()
        const pEnd = R(view).page
        leaf.detach()
        return { pages: [p0, p1, pEnd], spans, text, first: first.range.toString() }
      `)
      expect(r.error).toBeUndefined()
      expect(r.pages![1]).toBe(r.pages![0] + 1)
      expect(r.pages![2]).toBe(r.pages![1])
      expect(r.spans).toBe(true)
      expect(r.text!.startsWith(r.first!)).toBe(true)
    })

    it('with no finger to follow, as under iOS’s handles, the selection stays on its page and the buttons beside it carry it on', () => {
      const r = run<{
        error?: string
        pages?: number[]
        clamped?: boolean
        buttons?: boolean
        carried?: { page: number; spans: boolean; ends: string; debug?: string[] }
        grown?: boolean
        back?: { page: number; kept: boolean }
      }>(`
        const { leaf, view } = await open(${JSON.stringify(BOOK)})
        await fresh(view)
        const visible = view.engine.lastLocation.range
        const list = words(view)
        const first = list[Math.floor(list.length / 2)]
        const doc = docOf(view)
        const sel = doc.getSelection()
        select(view, first.range)
        await until(() => view.model.selection, 3000)
        const p0 = R(view).page
        // What WebKit does with a handle dragged below a page's text: the end of the chapter.
        const body = doc.body
        sel.setBaseAndExtent(first.range.startContainer, first.range.startOffset, body, body.childNodes.length)
        await wait(1500)
        const range = sel.getRangeAt(0)
        const clamped = R(view).page === p0 && visible.comparePoint(range.endContainer, range.endOffset) === 0
        // The buttons beside the page, tapped.
        const next = await until(() => view.contentEl.querySelector('.abele-book-reader__extend_next'), 3000)
        const buttons = !!next && !!view.contentEl.querySelector('.abele-book-reader__extend_prev')
        await shoot('phone-extend-buttons')
        const b = next.getBoundingClientRect()
        await tap(b.left + b.width / 2, b.top + b.height / 2)
        await wait(400)
        const after = sel.getRangeAt(0)
        const carried = {
          debug: [after.toString().slice(-40), words(view)[0]?.range.toString(), visible.toString().slice(-30)],
          page: R(view).page,
          spans: visible.comparePoint(after.endContainer, after.endOffset) > 0,
          ends: after.toString().trim().split(/\\s+/).pop(),
        }
        const onPage = words(view)
        await shoot('phone-extended')
        // Its end taken on further down the new page.
        const further = onPage[Math.floor(onPage.length / 2)]
        sel.setBaseAndExtent(first.range.startContainer, first.range.startOffset, further.range.endContainer, further.range.endOffset)
        await wait(300)
        const grown = sel.toString().trim().endsWith(further.range.toString())
        // Back a page: its start is already there, so the page only turns.
        const prev = view.contentEl.querySelector('.abele-book-reader__extend_prev').getBoundingClientRect()
        await tap(prev.left + prev.width / 2, prev.top + prev.height / 2)
        await wait(400)
        const back = { page: R(view).page, kept: sel.toString().startsWith(first.range.toString()) && sel.toString().trim().endsWith(further.range.toString()) }
        view.reading.clearSelection()
        leaf.detach()
        return { pages: [p0], clamped, buttons, carried, grown, back, firstWord: onPage[0]?.range.toString() }
      `)
      expect(r.error).toBeUndefined()
      expect(r.clamped).toBe(true)
      expect(r.buttons).toBe(true)
      expect(r.carried!.page).toBe(r.pages![0] + 1)
      expect(r.carried!.spans, JSON.stringify(r.carried)).toBe(true)
      expect(r.grown).toBe(true)
      expect(r.back).toEqual({ page: r.pages![0], kept: true })
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
