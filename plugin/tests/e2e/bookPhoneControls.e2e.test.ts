/**
 * The reader's controls on a phone, under `emulateMobile`, with touches sent through the app's
 * own input pipeline (the DevTools protocol, from inside the app):
 *
 * - dragging the progress slider moves through the book and does not open Obsidian's side panel;
 * - the text and layout dialog scrolls to its last row, and the note and comment dialogs show
 *   their buttons;
 * - a dialog with a search field keeps its size when the keyboard comes up (the keyboard is
 *   mimicked the way Obsidian's iPhone app reports it), and what the keyboard covers can be
 *   scrolled up above it;
 * - pictures and tables (`tests/fixtures/books/figureBook.ts`), upright and on the side: a
 *   picture that stands alone is centred, a small one among the words is left alone, a wide
 *   table scrolls sideways without turning the page, a tap on either opens it full screen,
 *   where a pinch zooms and a swipe down closes, and turning the phone keeps the place.
 *
 * Pictures of each go to `/tmp/abele-phone/controls-*.png` — look at them. A real keyboard, a
 * real finger and iOS's own gestures are for the phone itself.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw, evalJson, runCli } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildRichEpub } from '../fixtures/books/richBook'
import { buildFigureEpub } from '../fixtures/books/figureBook'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader controls e2e'
const RICH = `${DIR}/rich.epub`
const FIGURES = `${DIR}/figures.epub`
const SHOTS = '/tmp/abele-phone'
/** An iPhone keyboard with its suggestion bar, in points. */
const KEYBOARD = 336

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
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
  const touch = (type, points = []) => cdp.sendCommand('Input.dispatchTouchEvent', {
    type, touchPoints: points.map(([x, y], id) => ({ x: Math.round(x), y: Math.round(y), id })),
  })
  const tap = async (x, y) => { await touch('touchStart', [[x, y]]); await wait(60); await touch('touchEnd'); await wait(800) }
  const shoot = async (name) => {
    const img = await Promise.race([require('@electron/remote').getCurrentWebContents().capturePage(), wait(8000).then(() => null)])
    if (img) { require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true }); require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/controls-' + name + '.png', img.toPNG()) }
  }
  const open = async (path) => {
    for (const l of app.workspace.getLeavesOfType('abele-book')) l.detach()
    let leaf
    try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.getLeaf(false) }
    await leaf.setViewState({ type: 'abele-book', state: { file: path }, active: true })
    const view = leaf.view
    await until(() => view.model?.status === 'ready', 15000)
    await wait(800)
    return { leaf, view }
  }
  const R = (view) => view.engine.renderer
  const docOf = (view) => R(view).getContents()[0].doc
  /** An element of the page, in the window's coordinates. */
  const onScreen = (view, el) => {
    const f = el.ownerDocument.defaultView.frameElement.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    return { left: r.left + f.left, top: r.top + f.top, width: r.width, height: r.height, x: r.left + f.left + r.width / 2, y: r.top + f.top + r.height / 2 }
  }
  /** Turns until an element of the page is on screen. */
  const turnTo = async (view, el) => {
    // A picture has no size until it has loaded, and would then seem to be anywhere.
    await until(() => el.localName !== 'img' || (el.complete && el.naturalWidth), 5000)
    await wait(300)
    await R(view).scrollToAnchor(el); await wait(700)
    const s = R(view).getBoundingClientRect(), p = onScreen(view, el)
    return !!p.width && p.left >= s.left - 2 && p.left + p.width / 2 < s.right
  }
  const keyboard = (height) => {
    if (height) document.documentElement.style.setProperty('--keyboard-height', height + 'px')
    else document.documentElement.style.removeProperty('--keyboard-height')
    const ev = new Event(height ? 'keyboardWillShow' : 'keyboardWillHide')
    if (height) ev.keyboardHeight = height
    window.dispatchEvent(ev)
  }
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    120_000
  )

describe.skipIf(!available)('the reader’s controls on a phone', () => {
  let savedReader: unknown = null
  let size: [number, number] = [0, 0]

  beforeAll(async () => {
    attachDebugger()
    const files = {
      'rich.epub': Buffer.from(buildRichEpub()).toString('base64'),
      'figures.epub': Buffer.from(buildFigureEpub()).toString('base64'),
    }
    savedReader = evalJson<unknown>('window.__abeleTest.AbeleConfig.getInstance().reader')
    size = evalJson<[number, number]>(
      `require('@electron/remote').getCurrentWindow().getContentSize()`
    )
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
        cfg.reader = { ...cfg.reader, flow: 'paginated' }
        await cfg.saveSettings()
        return 'ok'
      })()`,
      60_000
    )
    await reload('app.emulateMobile(true)')
    await setWindowSize(390, 844)
    await reload('window.location.reload()')
  }, 240_000)

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
    if (size[0]) await setWindowSize(size[0], size[1])
    await reload('app.emulateMobile(false)')
  }, 180_000)

  it('dragging the progress slider moves through the book, not Obsidian’s side panel', () => {
    const r = run<{ error?: string; closed?: boolean[]; fraction?: number[] }>(`
      const { leaf, view } = await open(${JSON.stringify(RICH)})
      // From the start of the book, with room to move to the right.
      await view.engine.goTo(view.model.toc[0].href); await wait(600)
      app.workspace.leftSplit.collapse()
      const slider = view.contentEl.querySelector('.abele-book-reader__footer input[type=range]')
      const b = slider.getBoundingClientRect(), y = b.top + b.height / 2
      const f0 = view.model.fraction
      const x0 = b.left + 12
      await touch('touchStart', [[x0, y]])
      for (let i = 1; i <= 10; i++) { await touch('touchMove', [[x0 + i * 24, y]]); await wait(20) }
      await touch('touchEnd'); await wait(1200)
      const out = { closed: [true, app.workspace.leftSplit.collapsed], fraction: [f0, view.model.fraction] }
      app.workspace.leftSplit.collapse()
      leaf.detach()
      return out
    `)
    expect(r.error).toBeUndefined()
    expect(r.closed).toEqual([true, true])
    expect(r.fraction![1]).toBeGreaterThan(r.fraction![0] + 0.2)
  })

  it('the text and layout dialog scrolls to its last row; the note and comment dialogs show their buttons', () => {
    const r = run<{
      error?: string
      settings?: {
        scrolls: boolean
        last: string
        lastBottom: number
        boxBottom: number
        height: number
      }
      note?: number[]
      comment?: number[]
    }>(`
      const { leaf, view } = await open(${JSON.stringify(RICH)})
      view.model.settingsOpen = true
      await wait(900)
      const box = document.querySelector('.abele-book-reader__settings')
      const rows = [...box.querySelectorAll('.setting-item')]
      const scrolls = box.scrollHeight > box.clientHeight + 10
      box.scrollTop = box.scrollHeight
      await wait(400)
      const last = rows[rows.length - 1]
      const settings = { scrolls, last: last.querySelector('.setting-item-name')?.textContent ?? '', lastBottom: Math.round(last.getBoundingClientRect().bottom), boxBottom: Math.round(box.getBoundingClientRect().bottom), height: innerHeight }
      await shoot('settings-bottom')
      view.model.settingsOpen = false
      await wait(400)

      // A note, as a tap on its mark opens it.
      await view.engine.goTo(view.model.toc[0].href); await wait(600)
      const ref = docOf(view).getElementById('ref1')
      const at = onScreen(view, ref)
      await tap(at.x, at.y)
      await until(() => document.querySelector('.abele-book-reader__note-actions button'), 4000)
      const button = document.querySelector('.abele-book-reader__note-actions button')?.getBoundingClientRect()
      const note = button ? [Math.round(button.top), Math.round(button.bottom), innerHeight] : []
      await shoot('note')
      view.model.footnote && document.querySelector('.modal-close-button')?.click()
      await wait(500)

      // A comment on a highlight.
      view.model.commenting = { cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:5)', color: 'yellow', text: 'Chapter', comment: '', label: 'Chapter 1' }
      await until(() => document.querySelector('.modal textarea'), 4000)
      const buttons = [...document.querySelectorAll('.modal button')].map((b) => b.getBoundingClientRect())
      const comment = buttons.length ? [Math.round(Math.min(...buttons.map((b) => b.top))), Math.round(Math.max(...buttons.map((b) => b.bottom))), innerHeight] : []
      await shoot('comment')
      view.model.commenting = null
      await wait(400)
      leaf.detach()
      return { settings, note, comment }
    `)
    expect(r.error).toBeUndefined()
    expect(r.settings!.scrolls).toBe(true)
    expect(r.settings!.last).toBe('Speed')
    expect(r.settings!.lastBottom).toBeLessThanOrEqual(r.settings!.boxBottom)
    expect(r.settings!.boxBottom).toBeLessThanOrEqual(r.settings!.height)
    expect(r.note!.length).toBe(3)
    expect(r.note![1]).toBeLessThanOrEqual(r.note![2])
    expect(r.comment!.length).toBe(3)
    expect(r.comment![1]).toBeLessThanOrEqual(r.comment![2])
  })

  it('a dialog with a search field keeps its size over the keyboard, and what is under it scrolls up', () => {
    const r = run<{
      error?: string
      before?: number
      after?: number
      cover?: string
      scroller?: { reach: number; under: number }
      field?: number
    }>(`
      window.__abeleTest.openIconPicker('play')
      await until(() => document.querySelector('.modal input'), 4000)
      for (const el of document.querySelectorAll('.modal, .modal-container')) el.style.transition = 'none'
      await wait(400)
      const dialog = document.querySelector('.modal')
      const before = Math.round(dialog.getBoundingClientRect().height)
      const input = dialog.querySelector('input')
      input.focus(); await wait(200)
      keyboard(${KEYBOARD}); await wait(800)
      const after = Math.round(dialog.getBoundingClientRect().height)
      const cover = document.querySelector('.modal-container').className
      const sc = dialog.querySelector('.abele-keyboard-scroller') ?? (dialog.classList.contains('abele-keyboard-scroller') ? dialog : null)
      const keyboardTop = innerHeight - ${KEYBOARD}
      // How much of the scroller lies under the keyboard, and how far it can scroll past the end
      // of what it holds: at least that much, so its last row can be brought above the keyboard.
      const scroller = sc ? { under: Math.round(sc.getBoundingClientRect().bottom - keyboardTop), reach: parseInt(sc.style.getPropertyValue('--abele-keyboard-cover')) } : null
      if (sc) { sc.scrollTop = sc.scrollHeight; await wait(300) }
      const lastItem = sc?.lastElementChild
      const field = lastItem ? Math.round(lastItem.getBoundingClientRect().bottom - keyboardTop) : 999
      await shoot('keyboard-icon-picker')
      keyboard(0); input.blur()
      document.querySelector('.modal-container .modal-close-button')?.click()
      await wait(500)
      return { before, after, cover, scroller, field }
    `)
    expect(r.error).toBeUndefined()
    expect(r.after).toBe(r.before)
    expect(r.cover).toContain('abele-keyboard-cover')
    expect(r.scroller).toBeTruthy()
    expect(r.scroller!.reach).toBeGreaterThanOrEqual(r.scroller!.under - 1)
    // Scrolled to the end, the last icon stands above the keyboard.
    expect(r.field).toBeLessThanOrEqual(0)
  })

  it('pictures and tables: centred, left small, scrolled sideways, opened full screen, zoomed and closed', () => {
    const r = run<{
      error?: string
      scan?: { centred: boolean; width: number }
      dot?: { display: string; width: number; opens: boolean }
      table?: { scrolls: boolean; pages: number[]; scrolled: number }
      viewer?: { opened: string; pages: number[]; zoomed: boolean; closed: boolean }
      tableViewer?: { opened: string; frame: boolean; sandbox: string | null }
    }>(`
      const { leaf, view } = await open(${JSON.stringify(FIGURES)})
      const doc = docOf(view)
      const scanEl = doc.getElementById('scan'), dotEl = doc.getElementById('dot'), tableEl = doc.getElementById('wide')
      // The small picture among the words: left as it is, and a tap on it opens nothing.
      await turnTo(view, dotEl)
      const d = onScreen(view, dotEl)
      await tap(d.x, d.y)
      const dot = { display: getComputedStyle(dotEl).display, width: Math.round(d.width), opens: !!view.model.figure }
      view.model.figure = null
      // The scan: centred in its column, and opened by a tap without turning the page.
      await turnTo(view, scanEl)
      const s = onScreen(view, scanEl)
      const column = scanEl.parentElement.getBoundingClientRect()
      const scan = { centred: Math.abs((scanEl.getBoundingClientRect().left - column.left) - (column.right - scanEl.getBoundingClientRect().right)) < 3, width: Math.round(s.width) }
      await shoot('figure-page')
      const p0 = R(view).page
      await tap(s.x, s.y)
      await until(() => view.model.figure, 3000)
      const opened = view.model.figure?.kind ?? ''
      await until(() => document.querySelector('.abele-book-figure'), 3000)
      await wait(400)
      await shoot('figure-viewer')
      const canvas = () => document.querySelector('.abele-book-figure__canvas').style.transform
      const scaleOf = () => Number(/scale\\(([\\d.]+)\\)/.exec(canvas())?.[1] ?? 0)
      const fitScale = scaleOf()
      const f = document.querySelector('.abele-book-figure').getBoundingClientRect()
      const cx = f.left + f.width / 2, cy = f.top + f.height / 2
      await touch('touchStart', [[cx - 30, cy], [cx + 30, cy]])
      for (let i = 1; i <= 6; i++) { await touch('touchMove', [[cx - 30 - i * 25, cy], [cx + 30 + i * 25, cy]]); await wait(30) }
      await touch('touchEnd'); await wait(400)
      const zoomed = scaleOf() > fitScale * 2
      await shoot('figure-zoomed')
      document.querySelector('.abele-book-figure__controls [aria-label="Fit it on the screen"]').click(); await wait(300)
      await touch('touchStart', [[cx, cy - 80]])
      for (let i = 1; i <= 6; i++) { await touch('touchMove', [[cx + 2, cy - 80 + i * 30]]); await wait(20) }
      await touch('touchEnd'); await wait(700)
      const viewer = { opened, pages: [p0, R(view).page], zoomed, closed: !view.model.figure && !document.querySelector('.abele-book-figure') }
      // The wide table: it scrolls sideways under a finger, and the page stays.
      await turnTo(view, tableEl)
      const t = onScreen(view, tableEl)
      const pt0 = R(view).page
      const scrolls = tableEl.scrollWidth > tableEl.clientWidth + 10 && getComputedStyle(tableEl).overflowX === 'auto'
      const ty = t.top + Math.min(t.height / 2, 20)
      await touch('touchStart', [[t.left + t.width - 20, ty]])
      for (let i = 1; i <= 6; i++) { await touch('touchMove', [[t.left + t.width - 20 - i * 30, ty]]); await wait(16) }
      await touch('touchEnd'); await wait(900)
      const table = { scrolls, pages: [pt0, R(view).page], scrolled: tableEl.scrollLeft }
      await tap(t.left + 30, ty)
      const tableOpened = view.model.figure?.kind ?? ''
      await until(() => document.querySelector('.abele-book-figure__table'), 3000)
      await wait(600)
      const frame = document.querySelector('.abele-book-figure__table')
      await shoot('figure-table')
      const tableViewer = { opened: tableOpened, frame: !!frame, sandbox: frame?.getAttribute('sandbox') ?? null }
      view.model.figure = null
      await wait(300)
      leaf.detach()
      return { scan, dot, table, viewer, tableViewer }
    `)
    expect(r.error).toBeUndefined()
    expect(r.dot).toMatchObject({ display: 'inline', opens: false })
    expect(r.dot!.width).toBeLessThan(40)
    expect(r.scan!.centred).toBe(true)
    expect(r.viewer).toMatchObject({ opened: 'image', zoomed: true, closed: true })
    expect(r.viewer!.pages[1]).toBe(r.viewer!.pages[0])
    expect(r.table!.scrolls).toBe(true)
    expect(r.table!.pages[1]).toBe(r.table!.pages[0])
    expect(r.table!.scrolled).toBeGreaterThan(20)
    expect(r.tableViewer).toEqual({ opened: 'table', frame: true, sandbox: 'allow-same-origin' })
  })

  it('turned on its side, the page is laid out anew at the same place, the picture centred', () => {
    const r = run<{ error?: string; kept?: boolean; pages?: number[]; centred?: boolean }>(`
      const { leaf, view } = await open(${JSON.stringify(FIGURES)})
      await view.engine.goTo(view.model.toc[0].href); await wait(500)
      for (let i = 0; i < 3; i++) { await R(view).next(); await wait(400) }
      await wait(500)
      const before = view.engine.lastLocation.range
      const start = [before.startContainer, before.startOffset]
      const p0 = R(view).page
      const win = require('@electron/remote').getCurrentWindow()
      win.setContentSize(844, 390)
      await wait(2000)
      // What began the page upright is on the page on its side.
      const after = view.engine.lastLocation.range
      const kept = after.comparePoint(start[0], start[1]) === 0
      const scanEl = docOf(view).getElementById('scan')
      const column = scanEl.parentElement.getBoundingClientRect(), own = scanEl.getBoundingClientRect()
      const centred = Math.abs((own.left - column.left) - (column.right - own.right)) < 3
      await turnTo(view, scanEl)
      await shoot('figure-landscape')
      win.setContentSize(390, 844)
      await wait(1500)
      leaf.detach()
      return { kept, pages: [p0], centred }
    `)
    expect(r.error).toBeUndefined()
    expect(r.kept).toBe(true)
    expect(r.centred).toBe(true)
  })
})
