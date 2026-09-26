/**
 * Zooming a PDF in the running app, through the app's own input (the DevTools protocol): Ctrl with
 * the wheel and a two-finger pinch keep the place under the pointer or the fingers where it was;
 * the page is drawn again sharp at its new size, its words (the text layer) over the same place of
 * it; the buttons under the page step and fit; the zoom is kept for the book when it is opened
 * again. While drawing, two fingers zoom rather than draw or move, ink already drawn stays on its
 * words, and a stroke drawn after the zoom lands where the pen went. Pages turned one at a time
 * zoom too, and a page wider than the screen scrolls from its left edge.
 *
 * A picture of the zoomed page and its line goes to `/tmp/abele-phone/zoom-desktop.png`; the line
 * on a phone is measured and pictured by `bookPdfInk.e2e.test.ts`.
 *
 * What cannot be checked here: an iPad's own touches, its memory, how smooth it is under a real
 * hand. The touches here are Chromium's.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw, evalJson, runCli } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildLongPdf } from '../fixtures/books/pdfFixture'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader zoom e2e'
const PDF = `${DIR}/long.pdf`

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 8000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(50) }
    return null
  }
  const cdp = require('@electron/remote').getCurrentWebContents().debugger
  const wheel = (x, y, deltaY) =>
    cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(x), y: Math.round(y), deltaX: 0, deltaY, modifiers: 2 })
  const touches = (type, pts) =>
    cdp.sendCommand('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), id: p.id })) })
  /** Two fingers either side of a point, from one distance apart to another. */
  const pinch = async (cx, cy, d0, d1, dy = 0) => {
    const at = (d, k) => [{ id: 1, x: cx - d / 2, y: cy + dy * k }, { id: 2, x: cx + d / 2, y: cy + dy * k }]
    await touches('touchStart', at(d0, 0))
    for (let i = 1; i <= 12; i++) { await touches('touchMove', at(d0 + (d1 - d0) * i / 12, i / 12)); await wait(16) }
    await touches('touchEnd', [])
    await wait(900)
  }
  const input = (type, x, y, pointerType, force, buttons) =>
    cdp.sendCommand('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: 'left', buttons, clickCount: 1, pointerType, force })
  const draw = async (x0, y0, x1, y1) => {
    await input('mousePressed', x0, y0, 'pen', 0.5, 1)
    for (let i = 1; i <= 12; i++) { await input('mouseMoved', x0 + (x1 - x0) * i / 12, y0 + (y1 - y0) * i / 12, 'pen', 0.5, 1); await wait(8) }
    await input('mouseReleased', x1, y1, 'pen', 0, 0)
    await wait(200)
  }
  const open = async (path) => {
    await until(() => app.workspace.layoutReady, 15000)
    let leaf
    try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.getLeaf(false) }
    await leaf.setViewState({ type: 'abele-book', state: { file: path }, active: true })
    await app.workspace.revealLeaf(leaf)
    await until(() => leaf.view?.model?.status === 'ready' && leaf.view.pdfZoom, 15000)
    const view = leaf.view
    if (view.model.panel) view.model.panel = false
    await until(() => view.engine.renderer.getContents().some((c) => c.doc?.querySelector('#canvas img')), 8000)
    await wait(600)
    return { leaf, view }
  }
  const R = (view) => view.engine.renderer
  const page = (view, index) => R(view).getContents().find((c) => c.index === index || (c.index === undefined && c.doc?.querySelector('#canvas img')))?.doc
  const frame = (doc) => doc.defaultView.frameElement.getBoundingClientRect()
  const q = (view, sel) => view.contentEl.querySelector(sel)
  /** Where a point of the screen is on a page, as fractions of the page. */
  const onPage = (doc, x, y) => { const f = frame(doc); return { fx: (x - f.left) / f.width, fy: (y - f.top) / f.height } }
  /** A box inside a page — measured in the page's own frame, whose origin is the page's corner — as fractions of the page. */
  const inPage = (doc, r) => { const f = frame(doc); return [r.left / f.width, r.top / f.height, r.width / f.width, r.height / f.height] }
  /** A word of the page's text layer, as fractions of the page: it has to stay on its words. */
  const word = (doc) => { const s = [...doc.querySelectorAll('.textLayer span')].find((e) => e.getBoundingClientRect().width > 4); return s ? inPage(doc, s.getBoundingClientRect()) : null }
  const sharp = (doc) => { const img = doc.querySelector('#canvas img'); return img.naturalWidth / frame(doc).width }
  const shoot = async (name) => {
    const img = await Promise.race([require('@electron/remote').getCurrentWebContents().capturePage(), wait(8000).then(() => null)])
    if (img) { require('fs').mkdirSync('/tmp/abele-phone', { recursive: true }); require('fs').writeFileSync('/tmp/abele-phone/zoom-' + name + '.png', img.toPNG()) }
  }
  const settings = async (over) => {
    const cfg = window.__abeleTest.AbeleConfig.getInstance()
    cfg.reader = { ...cfg.reader, ...over }
    await cfg.saveSettings()
    await wait(300)
  }
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    120_000
  )

const close = (a: number[] | null | undefined, b: number[] | null | undefined, within = 0.01) => {
  expect(a).toBeTruthy()
  expect(b).toBeTruthy()
  a!.forEach((v, i) => expect(Math.abs(v - b![i])).toBeLessThan(within))
}

describe.skipIf(!available)('zooming a PDF', () => {
  let savedReader: unknown = null

  beforeAll(() => {
    runCli(['dev:debug', 'on'], 30_000)
    savedReader = evalJson<unknown>('window.__abeleTest.AbeleConfig.getInstance().reader')
    const data = Buffer.from(buildLongPdf(6)).toString('base64')
    evalRaw(
      `(async () => {
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        const bytes = Uint8Array.from(atob(${JSON.stringify(data)}), (c) => c.charCodeAt(0))
        await app.vault.createBinary(${JSON.stringify(PDF)}, bytes.buffer)
        app.saveLocalStorage('abele-pdf-zoom', null)
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = { ...cfg.reader, pdfLayout: 'scrolled', pdfZoom: 'fit-width' }
        await cfg.saveSettings()
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  afterAll(() => {
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
        app.saveLocalStorage('abele-pdf-zoom', null)
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = ${JSON.stringify(savedReader)}
        await cfg.saveSettings()
        await new Promise((r) => setTimeout(r, 1500))
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  it('zooms by Ctrl and the wheel around the pointer, drawn again sharp, its words on the page', () => {
    const r = run<{
      error?: string
      before?: number
      after?: number
      at?: { fx: number; fy: number }
      still?: { fx: number; fy: number }
      wordBefore?: number[] | null
      wordAfter?: number[] | null
      sharpness?: number
      dpr?: number
      label?: string
    }>(`
      const { view } = await open(${JSON.stringify(PDF)})
      await view.engine.goTo(1); await wait(800)
      const doc = page(view, 1)
      const f = frame(doc)
      const x = f.left + f.width * 0.3, y = Math.min(f.top + f.height * 0.3, innerHeight - 200)
      const at = onPage(doc, x, y)
      const before = R(view).scale
      const wordBefore = word(doc)
      for (let i = 0; i < 4; i++) { await wheel(x, y, -60); await wait(30) }
      await wait(1200)
      const after = R(view).scale
      const still = onPage(doc, x, y)
      // As many pixels as the screen has, or as a page may take in memory (8 million), not fewer.
      const meta = doc.querySelector('meta[name="viewport"]').content
      const pw = Number(/width=([\\d.]+)/.exec(meta)[1]), ph = Number(/height=([\\d.]+)/.exec(meta)[1])
      const dpr = Math.max(1, Math.min(devicePixelRatio, Math.sqrt(8e6 / (pw * after * ph * after))))
      await until(() => Math.abs(sharp(doc) - dpr) < 0.05, 4000)
      await shoot('desktop')
      return { before, after, at, still, wordBefore, wordAfter: word(doc), sharpness: sharp(doc), dpr, label: q(view, '.abele-book-reader__zoom')?.textContent.trim() }
    `)
    expect(r.error).toBeUndefined()
    expect(r.after!).toBeGreaterThan(r.before! * 1.3)
    expect(Math.abs(r.still!.fx - r.at!.fx)).toBeLessThan(0.01)
    expect(Math.abs(r.still!.fy - r.at!.fy)).toBeLessThan(0.01)
    close(r.wordBefore, r.wordAfter)
    expect(Math.abs(r.sharpness! - r.dpr!)).toBeLessThan(0.05)
    expect(r.label).toBe(`${Math.round(r.after! * 100)}%`)
  })

  it('zooms by two fingers around them, then steps and fits from the buttons, and keeps the zoom for the book', () => {
    const r = run<{
      error?: string
      before?: number
      pinched?: number
      at?: { fx: number; fy: number }
      still?: { fx: number; fy: number }
      stepped?: number
      fitPage?: boolean
      kept?: number
      afterReset?: number
      forgotten?: boolean
    }>(`
      const view = app.workspace.getLeavesOfType('abele-book')[0].view
      view.zoom('reset'); await wait(800)
      const doc = page(view, 1)
      const f = frame(doc)
      const cx = f.left + f.width * 0.5, cy = Math.min(f.top + f.height * 0.4, innerHeight - 250)
      const at = onPage(doc, cx, cy)
      const before = R(view).scale
      await pinch(cx, cy, 100, 200)
      const pinched = R(view).scale
      const still = onPage(page(view, 1), cx, cy)
      q(view, '.abele-book-reader__zoom-in').click(); await wait(600)
      const stepped = R(view).scale
      view.zoom('fit-page'); await wait(600)
      const box = R(view).getBoundingClientRect()
      const fitPage = frame(page(view, R(view).index)).height <= box.height
      view.zoom('in'); await wait(600)
      const kept0 = R(view).scale
      for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
      await wait(800)
      const again = await open(${JSON.stringify(PDF)})
      const kept = R(again.view).scale - kept0
      again.view.zoom('reset'); await wait(600)
      const afterReset = R(again.view).scale - before
      const forgotten = !JSON.parse(app.loadLocalStorage('abele-pdf-zoom') || '{}')[again.view.key]
      return { before, pinched, at, still, stepped, fitPage, kept, afterReset, forgotten }
    `)
    expect(r.error).toBeUndefined()
    expect(r.pinched! / r.before!).toBeGreaterThan(1.7)
    expect(r.pinched! / r.before!).toBeLessThan(2.3)
    expect(Math.abs(r.still!.fx - r.at!.fx)).toBeLessThan(0.02)
    expect(Math.abs(r.still!.fy - r.at!.fy)).toBeLessThan(0.02)
    expect(r.stepped!).toBeGreaterThan(r.pinched!)
    expect(r.fitPage).toBe(true)
    expect(Math.abs(r.kept!)).toBeLessThan(0.001)
    expect(Math.abs(r.afterReset!)).toBeLessThan(0.001)
    expect(r.forgotten).toBe(true)
  })

  it('zooms by two fingers while drawing, drawing nothing, the ink staying on its words', () => {
    const r = run<{
      error?: string
      before?: number
      pinched?: number
      wheeled?: number
      paths?: number
      pathsAfter?: number
      inkBefore?: number[] | null
      inkAfter?: number[] | null
      svgFits?: boolean
      point?: number[]
    }>(`
      const view = app.workspace.getLeavesOfType('abele-book')[0]?.view ?? (await open(${JSON.stringify(PDF)})).view
      await view.engine.goTo(2); await wait(800)
      q(view, '.abele-book-reader__draw').click()
      await until(() => q(view, '.abele-ink-overlay'))
      const doc = page(view, 2)
      let f = frame(doc)
      await draw(f.left + f.width * 0.2, f.top + f.height * 0.2, f.left + f.width * 0.6, f.top + f.height * 0.25)
      const path = () => doc.querySelector(':scope > svg.abele-ink path:last-child')
      const paths = doc.querySelectorAll(':scope > svg.abele-ink path').length
      const inkBefore = inPage(doc, path().getBoundingClientRect())
      const before = R(view).scale
      f = frame(doc)
      const cx = f.left + f.width * 0.4, cy = f.top + f.height * 0.22
      await pinch(cx, cy, 120, 200)
      const pinched = R(view).scale
      await wait(600)
      const pathsAfter = doc.querySelectorAll(':scope > svg.abele-ink path').length
      const inkAfter = inPage(doc, path().getBoundingClientRect())
      const svg = doc.querySelector(':scope > svg.abele-ink').getBoundingClientRect()
      f = frame(doc)
      const svgFits = Math.abs(svg.width - f.width) < 1.5 && Math.abs(svg.height - f.height) < 1.5
      // A stroke drawn now, at the zoom, is kept where the pen went on the page — the part of it
      // on screen, which is the sheet's: a page wider than the tab runs under the sidebar.
      const sheet = q(view, '.abele-ink-overlay').getBoundingClientRect()
      const px = Math.max(f.left, sheet.left) + 60, py = Math.max(f.top, sheet.top) + 120
      const want = onPage(doc, px, py)
      await draw(px, py, px + 40, py + 10)
      const last = view.ink.pages.get(2).strokes.at(-1)
      const point = [last.points[0] / view.ink.pages.get(2).width - want.fx, last.points[1] / view.ink.pages.get(2).height - want.fy]
      const o = q(view, '.abele-ink-overlay').getBoundingClientRect()
      for (let i = 0; i < 3; i++) { await wheel(o.left + o.width / 2, o.top + o.height / 2, 60); await wait(30) }
      await wait(1000)
      const wheeled = R(view).scale
      q(view, '.abele-book-ink__done').click()
      await wait(300)
      return { before, pinched, wheeled, paths, pathsAfter, inkBefore, inkAfter, svgFits, point }
    `)
    expect(r.error).toBeUndefined()
    expect(r.pinched! / r.before!).toBeGreaterThan(1.4)
    expect(r.wheeled!).toBeLessThan(r.pinched!)
    expect(r.paths).toBe(1)
    expect(r.pathsAfter).toBe(1)
    close(r.inkBefore, r.inkAfter)
    expect(r.svgFits).toBe(true)
    expect(Math.abs(r.point![0])).toBeLessThan(0.01)
    expect(Math.abs(r.point![1])).toBeLessThan(0.01)
  })

  it('zooms pages turned one at a time, a page wider than the screen scrolling from its left edge', () => {
    const r = run<{
      error?: string
      before?: number
      after?: number
      wide?: boolean
      leftEdge?: number
      swiped?: number
    }>(`
      for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
      app.saveLocalStorage('abele-pdf-zoom', null)
      await settings({ pdfLayout: 'paginated', pdfZoom: 'auto' })
      const { view } = await open(${JSON.stringify(PDF)})
      await view.engine.goTo(1); await wait(800)
      const before = R(view).scale
      view.zoom('in'); view.zoom('in'); view.zoom('in'); view.zoom('in'); view.zoom('in'); view.zoom('in')
      await wait(1000)
      const after = R(view).scale
      const el = R(view)
      const wide = el.scrollWidth > el.clientWidth + 1
      el.scrollLeft = 0; await wait(100)
      const doc = await until(() => R(view).getContents().map((c) => c.doc).find((d) => d?.querySelector('#canvas img') && frame(d).width > 0))
      const leftEdge = frame(doc).left - el.getBoundingClientRect().left
      view.zoom('reset'); await wait(600)
      await settings({ pdfLayout: 'scrolled', pdfZoom: 'fit-width' })
      return { before, after, wide, leftEdge }
    `)
    expect(r.error).toBeUndefined()
    expect(r.after!).toBeGreaterThan(r.before!)
    expect(r.wide).toBe(true)
    expect(r.leftEdge!).toBeGreaterThanOrEqual(-1)
  })
})
