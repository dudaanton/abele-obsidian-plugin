/**
 * Drawing on a PDF's pages, in the running app: the pen under the page turns drawing on; a pen
 * sent through the app's own input (the DevTools protocol, `pointerType: 'pen'` with a pressure)
 * draws on the page it is over, wider where it presses harder; the stroke is written beside the
 * book as an SVG and its page's callout goes into the book's note; the eraser, undo and redo; a
 * finger moves the pages rather than drawing; nothing that lands on the pages reaches Obsidian's
 * own listeners while drawing is on; and when it goes off everything is as it was. Opened again,
 * the book shows its ink, and ink written by another device is drawn when it arrives.
 *
 * Then on a phone at 390×844 and a tablet at 820×1180 under `emulateMobile`: the bar fits its
 * row, a phone's finger draws and a tablet's moves the pages. Pictures go to
 * `/tmp/abele-phone/ink-*.png` — look at them.
 *
 * What cannot be checked here: an Apple Pencil on an iPad — WebKit's own stylus touches, the
 * palm, Scribble, the pencil's full rate of points. The pen here is Chromium's.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  evalJson,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  runCli,
} from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildLongPdf } from '../fixtures/books/pdfFixture'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader ink e2e'
const PDF = `${DIR}/long.pdf`
const INK = `${DIR}/long ink/long page 1.svg`
const NOTE = `${DIR}/long highlights.md`
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
const attachDebugger = (): void => void runCli(['dev:debug', 'on'], 30_000)
const reload = async (how: string): Promise<void> => {
  await reloadApp(how)
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
  const input = (type, x, y, pointerType, force, buttons) =>
    cdp.sendCommand('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: 'left', buttons, clickCount: 1, pointerType, force })
  /** A line drawn by a pen or the mouse from one point to another, the pressure going from one value to another. */
  const draw = async (x0, y0, x1, y1, kind = 'pen', p0 = 0.5, p1 = 0.5) => {
    await input('mousePressed', x0, y0, kind, p0, 1)
    for (let i = 1; i <= 12; i++) { await input('mouseMoved', x0 + (x1 - x0) * i / 12, y0 + (y1 - y0) * i / 12, kind, p0 + (p1 - p0) * i / 12, 1); await wait(8) }
    await input('mouseReleased', x1, y1, kind, 0, 0)
    await wait(150)
  }
  const touch = (type, x, y) =>
    cdp.sendCommand('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y) }] })
  const drag = async (x0, y0, x1, y1) => {
    await touch('touchStart', x0, y0)
    for (let i = 1; i <= 10; i++) { await touch('touchMove', x0 + (x1 - x0) * i / 10, y0 + (y1 - y0) * i / 10); await wait(16) }
    await touch('touchEnd'); await wait(600)
  }
  const open = async (path) => {
    // Just after a reload the workspace may still be putting itself back: a tab made then is lost.
    await until(() => app.workspace.layoutReady, 15000)
    await wait(1000)
    let leaf
    try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.getLeaf(false) }
    await leaf.setViewState({ type: 'abele-book', state: { file: path }, active: true })
    await app.workspace.revealLeaf(leaf)
    await until(() => leaf.view?.model?.status === 'ready' && leaf.view.ink, 15000)
    const view = leaf.view
    if (view.model.panel) view.model.panel = false
    await until(() => view.engine.renderer.getContents().some((c) => c.doc?.querySelector('#canvas img')), 8000)
    await wait(600)
    return { leaf, view }
  }
  const R = (view) => view.engine.renderer
  const page = (view, index) => R(view).getContents().find((c) => c.index === index || (c.index === undefined && c.doc?.querySelector('#canvas img')))?.doc
  const frame = (doc) => doc.defaultView.frameElement.getBoundingClientRect()
  const inked = (doc) => doc?.querySelectorAll(':scope > svg.abele-ink path').length ?? 0
  const q = (view, sel) => view.contentEl.querySelector(sel)
  const click = (view, sel) => q(view, sel).click()
  const read = async (path) => { const f = app.vault.getAbstractFileByPath(path); return f ? app.vault.read(f) : null }
  /** What reaches the document and the window: where Obsidian's own listeners are. */
  const listen = () => {
    const heard = []
    const types = ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchmove', 'touchend', 'contextmenu', 'wheel']
    const fn = (e) => heard.push(e.type)
    for (const t of types) { document.addEventListener(t, fn); window.addEventListener(t, fn) }
    return { heard, stop: () => { for (const t of types) { document.removeEventListener(t, fn); window.removeEventListener(t, fn) } } }
  }
  const shoot = async (name) => {
    const img = await Promise.race([require('@electron/remote').getCurrentWebContents().capturePage(), wait(8000).then(() => null)])
    if (img) { require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true }); require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/ink-' + name + '.png', img.toPNG()) }
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

describe.skipIf(!available)('drawing on the pages of a PDF', () => {
  let savedReader: unknown = null
  let size: [number, number] = [0, 0]

  beforeAll(() => {
    attachDebugger()
    savedReader = evalJson<unknown>('window.__abeleTest.AbeleConfig.getInstance().reader')
    size = windowSize()
    const data = Buffer.from(buildLongPdf(6)).toString('base64')
    evalRaw(
      `(async () => {
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        const bytes = Uint8Array.from(atob(${JSON.stringify(data)}), (c) => c.charCodeAt(0))
        await app.vault.createBinary(${JSON.stringify(PDF)}, bytes.buffer)
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = { ...cfg.reader, pdfLayout: 'scrolled', pdfZoom: 'fit-width' }
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
        await new Promise((r) => setTimeout(r, 1500))
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

  it('draws with the pen where it goes, wider where it presses, and keeps the stroke in the vault and the note', () => {
    const r = run<{
      error?: string
      overlay?: boolean
      bar?: boolean
      paths?: number
      heard?: string[]
      file?: string | null
      pressures?: number
      note?: string | null
    }>(`
      const { leaf, view } = await open(${JSON.stringify(PDF)})
      await view.engine.goTo(0); await wait(600)
      click(view, '.abele-book-reader__draw')
      const overlay = !!(await until(() => q(view, '.abele-ink-overlay')))
      const bar = !!(await until(() => q(view, '.abele-book-ink')))
      const doc = page(view, 0)
      const f = frame(doc)
      const ears = listen()
      await draw(f.left + f.width * 0.2, f.top + f.height * 0.2, f.left + f.width * 0.7, f.top + f.height * 0.3, 'pen', 0.1, 1)
      ears.stop()
      const paths = inked(doc)
      await until(async () => (await read(${JSON.stringify(INK)}))?.includes('data-tool'), 5000)
      const file = await read(${JSON.stringify(INK)})
      const points = (/data-points="([^"]*)"/.exec(file ?? '')?.[1] ?? '').split(' ').map(Number)
      const pressures = new Set(points.filter((_, i) => i % 3 === 2)).size
      const note = await until(async () => { const n = await read(${JSON.stringify(NOTE)}); return n?.includes('[!ink]') && n }, 5000)
      return { overlay, bar, paths, heard: ears.heard, file, pressures, note }
    `)
    expect(r.error).toBeUndefined()
    expect(r.overlay).toBe(true)
    expect(r.bar).toBe(true)
    expect(r.paths).toBe(1)
    // Obsidian's listeners heard nothing of the pen.
    expect(r.heard).toEqual([])
    expect(r.file).toContain('data-tool="pen"')
    expect(r.pressures).toBeGreaterThan(3)
    expect(r.note).toContain('type: book-highlights')
    // The link to the page in the vault's own link format; the picture by its whole path.
    expect(r.note).toMatch(/> \[!ink\] \[\[(.*\/)?long\.pdf#page=1\|Page 1\]\]/)
    expect(r.note).toContain(`> ![[${INK}]]`)
  })

  it('erases a stroke, and undoes and redoes; the file and the callout follow', () => {
    const r = run<{
      error?: string
      afterUndo?: number
      afterRedo?: number
      afterErase?: number
      fileGone?: boolean
      noteClean?: boolean
      afterUndoErase?: number
      fileBack?: boolean
      withMouse?: number
    }>(`
      const view = app.workspace.getLeavesOfType('abele-book')[0].view
      const doc = page(view, 0)
      const f = frame(doc)
      click(view, '.abele-book-ink__undo'); await wait(100)
      const afterUndo = inked(doc)
      click(view, '.abele-book-ink__redo'); await wait(100)
      const afterRedo = inked(doc)
      q(view, '.abele-book-ink__tool:nth-child(3)').click(); await wait(100)
      // Across the stroke's middle, top to bottom.
      const x = f.left + f.width * 0.45, y = f.top + f.height * 0.25
      await draw(x, y - 60, x, y + 60, 'pen')
      const afterErase = inked(doc)
      const fileGone = !!(await until(() => !app.vault.getAbstractFileByPath(${JSON.stringify(INK)}), 5000))
      const noteClean = !!(await until(async () => !(await read(${JSON.stringify(NOTE)}))?.includes('[!ink]'), 5000))
      click(view, '.abele-book-ink__undo'); await wait(100)
      const afterUndoErase = inked(doc)
      const fileBack = !!(await until(() => app.vault.getAbstractFileByPath(${JSON.stringify(INK)}), 5000))
      q(view, '.abele-book-ink__tool:nth-child(1)').click(); await wait(100)
      await draw(f.left + f.width * 0.2, f.top + f.height * 0.5, f.left + f.width * 0.6, f.top + f.height * 0.55, 'mouse')
      const withMouse = inked(doc)
      return { afterUndo, afterRedo, afterErase, fileGone, noteClean, afterUndoErase, fileBack, withMouse }
    `)
    expect(r.error).toBeUndefined()
    expect(r.afterUndo).toBe(0)
    expect(r.afterRedo).toBe(1)
    expect(r.afterErase).toBe(0)
    expect(r.fileGone).toBe(true)
    expect(r.noteClean).toBe(true)
    expect(r.afterUndoErase).toBe(1)
    expect(r.fileBack).toBe(true)
    expect(r.withMouse).toBe(2)
  })

  it('fills the line right to the pen while it is drawn, and draws as thick as chosen under the page', () => {
    const r = run<{
      error?: string
      tip?: number
      behind?: number
      past?: number
      chosen?: string
      saved?: string
      sizes?: string[]
      after?: number
    }>(`
      const view = app.workspace.getLeavesOfType('abele-book')[0].view
      const doc = page(view, 0)
      const f = frame(doc)
      const before = inked(doc)
      // A line on its way, the pen still down: is there ink right under the pen?
      const x0 = f.left + f.width * 0.2, x1 = f.left + f.width * 0.6, y = f.top + f.height * 0.75
      await input('mousePressed', x0, y, 'pen', 0.5, 1)
      for (let i = 1; i <= 12; i++) { await input('mouseMoved', x0 + (x1 - x0) * i / 12, y, 'pen', 0.5, 1); await wait(8) }
      await wait(120)
      const canvas = q(view, '.abele-ink-overlay__canvas')
      const box = canvas.getBoundingClientRect()
      const ratio = canvas.width / box.width
      const alpha = (x) => canvas.getContext('2d').getImageData(Math.round((x - box.left) * ratio), Math.round((y - box.top) * ratio), 1, 1).data[3]
      const tip = alpha(x1), behind = alpha(x1 - 3), past = alpha(x1 + 15)
      await input('mouseReleased', x1, y, 'pen', 0, 0)
      await wait(150)
      // Bold, from the button beside the colours.
      click(view, '.abele-book-ink__thickness')
      const pick = async (title) => {
        const item = await until(() => [...document.querySelectorAll('.menu .menu-item')].find((el) => el.textContent.trim() === title))
        item?.click()
        await wait(150)
      }
      await pick('Bold')
      const chosen = view.model.ink.thickness
      const saved = window.__abeleTest.AbeleConfig.getInstance().reader.pdfInkThickness
      await draw(f.left + f.width * 0.2, f.top + f.height * 0.8, f.left + f.width * 0.6, f.top + f.height * 0.8, 'pen')
      await until(async () => (await read(${JSON.stringify(INK)}))?.includes('data-size="4"'), 5000)
      const sizes = [...((await read(${JSON.stringify(INK)})) ?? '').matchAll(/data-size="([^"]*)"/g)].map((m) => m[1])
      // Both taken back, and the thickness as it was: what comes next counts the strokes before.
      click(view, '.abele-book-ink__undo'); await wait(100)
      click(view, '.abele-book-ink__undo'); await wait(100)
      click(view, '.abele-book-ink__thickness')
      await pick('Medium')
      const after = inked(doc) - before
      return { tip, behind, past, chosen, saved, sizes, after }
    `)
    expect(r.error).toBeUndefined()
    // Ink under the pen and behind it; the page beyond it untouched.
    expect(r.tip).toBeGreaterThan(200)
    expect(r.behind).toBeGreaterThan(200)
    expect(r.past).toBe(0)
    expect(r.chosen).toBe('bold')
    expect(r.saved).toBe('bold')
    expect(r.sizes).toContain('2.2')
    expect(r.sizes).toContain('4')
    expect(r.after).toBe(0)
  })

  it('lets a finger move the pages without drawing, and hands everything back when drawing stops', () => {
    const r = run<{
      error?: string
      moved?: number
      paths?: number
      heard?: string[]
      overlayGone?: boolean
      footer?: boolean
      marker?: number
    }>(`
      const view = app.workspace.getLeavesOfType('abele-book')[0].view
      const doc = page(view, 0)
      const before = frame(doc).top
      const stage = q(view, '.abele-book-reader__stage').getBoundingClientRect()
      const ears = listen()
      await drag(stage.left + stage.width / 2, stage.top + stage.height * 0.7, stage.left + stage.width / 2, stage.top + stage.height * 0.3)
      ears.stop()
      await wait(800)
      const moved = before - frame(doc).top
      const paths = inked(doc)
      // The marker, drawn in yellow, on the first page brought back.
      await view.engine.goTo(0); await wait(800)
      q(view, '.abele-book-ink__tool:nth-child(2)').click(); await wait(100)
      const f = frame(doc)
      await draw(f.left + f.width * 0.2, f.top + f.height * 0.4, f.left + f.width * 0.7, f.top + f.height * 0.4, 'pen')
      const marker = doc.querySelectorAll(':scope > svg.abele-ink path[stroke]').length
      click(view, '.abele-book-ink__done')
      const overlayGone = !!(await until(() => !q(view, '.abele-ink-overlay')))
      const footer = !!(await until(() => q(view, '.abele-book-reader__footer')))
      return { moved, paths, heard: ears.heard, overlayGone, footer, marker }
    `)
    expect(r.error).toBeUndefined()
    expect(r.moved).toBeGreaterThan(100)
    expect(r.paths).toBe(2)
    expect(r.heard).toEqual([])
    expect(r.marker).toBe(1)
    expect(r.overlayGone).toBe(true)
    expect(r.footer).toBe(true)
  })

  it('shows the ink when the book is opened again, and ink another device wrote when it arrives', () => {
    const r = run<{ error?: string; reopened?: number; arrived?: number }>(`
      for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
      await wait(1500)
      const { view } = await open(${JSON.stringify(PDF)})
      await view.engine.goTo(0); await wait(800)
      const doc = page(view, 0)
      const reopened = inked(doc)
      // Another device's copy: one more stroke, arriving as a change to the file.
      const text = await read(${JSON.stringify(INK)})
      const line = text.split('\\n').find((l) => l.startsWith('<path'))
      await app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(INK)}), text.replace('</svg>', line + '\\n</svg>'))
      const arrived = await until(() => inked(page(view, 0)) === reopened + 1 && inked(page(view, 0)), 5000)
      return { reopened, arrived }
    `)
    expect(r.error).toBeUndefined()
    expect(r.reopened).toBe(3)
    expect(r.arrived).toBe(4)
  })

  it('draws on pages turned one at a time too, and a finger turns them', () => {
    const r = run<{
      error?: string
      paths?: number
      before?: number
      after?: number
      seen?: unknown
    }>(`
      for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
      // The whole page on screen: at the width of the tab a page may run past the bottom of a short
      // window — as the window is after the files before this one — and the stroke with it.
      await settings({ pdfLayout: 'paginated', pdfZoom: 'fit-page' })
      const { view } = await open(${JSON.stringify(PDF)})
      await view.engine.goTo(1); await wait(800)
      click(view, '.abele-book-reader__draw')
      await until(() => q(view, '.abele-ink-overlay'))
      const doc = await until(() => R(view).getContents().map((c) => c.doc).find((d) => d?.querySelector('#canvas img') && frame(d).width > 0))
      const f = frame(doc)
      const o = q(view, '.abele-ink-overlay').getBoundingClientRect()
      const y0 = Math.min(f.top + f.height * 0.6, o.bottom - 60), y1 = Math.min(f.top + f.height * 0.7, o.bottom - 20)
      await draw(f.left + f.width * 0.3, y0, f.left + f.width * 0.6, y1, 'pen')
      const paths = inked(doc)
      const file = await until(() => app.vault.getAbstractFileByPath(${JSON.stringify(DIR)} + '/long ink/long page 2.svg'), 5000)
      const seen = { idx: R(view).getContents().map((c) => view.ink.docIndex.get(c.doc)), loc: view.engine.lastLocation?.section?.current, paths, pages: [...view.ink.pages.keys()], frames: R(view).getContents().map((c) => ({ index: c.index, w: c.doc ? frame(c.doc).width : null })), f: [f.left, f.top, f.width, f.height], overlay: q(view, '.abele-ink-overlay')?.getBoundingClientRect().toJSON() }
      const before = view.engine.lastLocation?.section?.current
      const stage = q(view, '.abele-book-reader__stage').getBoundingClientRect()
      await drag(stage.left + stage.width * 0.8, stage.top + stage.height / 2, stage.left + stage.width * 0.2, stage.top + stage.height / 2)
      await wait(800)
      const after = view.engine.lastLocation?.section?.current
      click(view, '.abele-book-ink__done')
      await settings({ pdfLayout: 'scrolled', pdfZoom: 'fit-width' })
      return { paths: file ? paths : -1, before, after, seen }
    `)
    expect(r.error).toBeUndefined()
    if (r.paths !== 1) console.log(JSON.stringify(r.seen))
    expect(r.paths).toBe(1)
    expect(r.before).toBe(1)
    expect(r.after).toBe(2)
  })

  it('fits its bar on a phone, where a finger draws, and on a tablet, where it moves the pages', async () => {
    await reload('app.emulateMobile(true)')
    await setWindowSize(390, 844)
    await reload('location.reload()')
    const phone = run<{
      error?: string
      line?: {
        foot: DOMRect
        pen: DOMRect
        mark: DOMRect
        overflow: number
      }
      fits?: boolean
      finger?: boolean
      paths?: number
      heard?: string[]
      bar?: { height: number; top: number; bottom: number; window: number }
    }>(`
      for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
      const { view } = await open(${JSON.stringify(PDF)})
      await view.engine.goTo(2); await wait(800)
      // The line under the page before drawing: the pen at its start, the bookmark at its end, all inside it.
      const foot = q(view, '.abele-book-reader__footer').getBoundingClientRect()
      const pen = q(view, '.abele-book-reader__draw').getBoundingClientRect()
      const mark = q(view, '.abele-book-reader__bookmark').getBoundingClientRect()
      const line = { foot: foot.toJSON(), pen: pen.toJSON(), mark: mark.toJSON(), overflow: q(view, '.abele-book-reader__footer').scrollWidth - q(view, '.abele-book-reader__footer').clientWidth }
      await shoot('phone-line')
      click(view, '.abele-book-reader__draw')
      const barEl = await until(() => q(view, '.abele-book-ink'))
      await wait(400)
      const fits = barEl.scrollWidth <= barEl.clientWidth + 1
      const b = barEl.getBoundingClientRect()
      const finger = view.model.ink.finger
      const doc = await until(() => page(view, 2)?.querySelector('#canvas img') && page(view, 2))
      const f = frame(doc)
      const ears = listen()
      await drag(f.left + f.width * 0.2, f.top + 80, f.left + f.width * 0.7, f.top + 140)
      ears.stop()
      const paths = inked(doc)
      await shoot('phone')
      return { line, fits, finger, paths, heard: ears.heard, bar: { height: b.height, top: b.top, bottom: b.bottom, window: window.innerHeight } }
    `)
    expect(phone.error).toBeUndefined()
    const { foot, pen, mark, overflow } = phone.line!
    expect(overflow).toBeLessThanOrEqual(1)
    expect(pen.left).toBeGreaterThanOrEqual(foot.left)
    expect(mark.right).toBeLessThanOrEqual(foot.right + 1)
    expect(pen.right).toBeLessThan(mark.left)
    expect(phone.fits).toBe(true)
    expect(phone.finger).toBe(true)
    expect(phone.paths).toBe(1)
    expect(phone.heard).toEqual([])
    expect(phone.bar!.bottom).toBeLessThanOrEqual(phone.bar!.window)

    await setWindowSize(820, 1180)
    await reload('location.reload()')
    const tablet = run<{ error?: string; finger?: boolean; paths?: number; moved?: number }>(`
      for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
      const { view } = await open(${JSON.stringify(PDF)})
      await view.engine.goTo(2); await wait(800)
      click(view, '.abele-book-reader__draw')
      await until(() => q(view, '.abele-book-ink'))
      await wait(400)
      const finger = view.model.ink.finger
      const doc = await until(() => page(view, 2)?.querySelector('#canvas img') && page(view, 2))
      if (!doc) return { error: 'no page 3: ' + JSON.stringify({ size: [innerWidth, innerHeight], contents: R(view).getContents().map((c) => [c.index, !!c.doc?.querySelector('#canvas img')]), status: view.model.status, stage: q(view, '.abele-book-reader__stage')?.getBoundingClientRect().toJSON(), shown: view.containerEl.isShown(), tablet: document.body.className, leaves: app.workspace.getLeavesOfType('abele-book').length, sized: R(view).sized }) }
      const top = frame(doc).top
      const before = inked(doc)
      const stage = q(view, '.abele-book-reader__stage').getBoundingClientRect()
      await drag(stage.left + stage.width / 2, stage.top + stage.height * 0.6, stage.left + stage.width / 2, stage.top + stage.height * 0.4)
      await wait(600)
      const moved = top - frame(doc).top
      const after = inked(doc)
      await view.engine.goTo(2); await wait(600)
      await shoot('tablet')
      click(view, '.abele-book-ink__done')
      return { finger, paths: after - before, moved }
    `)
    expect(tablet.error).toBeUndefined()
    expect(tablet.finger).toBe(false)
    expect(tablet.paths).toBe(0)
    expect(tablet.moved).toBeGreaterThan(50)
  }, 240_000)
})
