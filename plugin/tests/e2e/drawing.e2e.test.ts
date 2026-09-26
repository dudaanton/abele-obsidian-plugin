/**
 * The drawing canvas in the running app: a new drawing opens ready to draw on; a pen sent through
 * the app's own input (the DevTools protocol, `pointerType: 'pen'` with a pressure) leaves a
 * stroke that is kept in the SVG with its pressure; the eraser, undo and redo; a finger and the
 * wheel move the drawing, two fingers and Ctrl with the wheel zoom it; nothing that lands on it
 * reaches Obsidian's own listeners; the file opened from anywhere comes back in the drawing's tab
 * with what was drawn, while any other SVG stays in Obsidian's; a change from another device is
 * drawn when it arrives.
 *
 * Then on a phone at 390×844 and a tablet at 820×1180 under `emulateMobile`: the bar fits, a
 * phone's finger draws and a tablet's moves the drawing. Pictures go to
 * `/tmp/abele-phone/drawing-*.png` — look at them.
 *
 * What cannot be checked here: an Apple Pencil on an iPad. The pen here is Chromium's.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw, evalJson, runCli } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele drawing e2e'
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
  const DIR = ${JSON.stringify(DIR)}
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 8000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(50) }
    return null
  }
  const cdp = require('@electron/remote').getCurrentWebContents().debugger
  const input = (type, x, y, pointerType, force, buttons, modifiers = 0) =>
    cdp.sendCommand('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: 'left', buttons, clickCount: 1, pointerType, force, modifiers })
  const draw = async (x0, y0, x1, y1, kind = 'pen', p0 = 0.5, p1 = 0.5) => {
    await input('mousePressed', x0, y0, kind, p0, 1)
    for (let i = 1; i <= 12; i++) { await input('mouseMoved', x0 + (x1 - x0) * i / 12, y0 + (y1 - y0) * i / 12, kind, p0 + (p1 - p0) * i / 12, 1); await wait(8) }
    await input('mouseReleased', x1, y1, kind, 0, 0)
    await wait(150)
  }
  /** A line through several points, pressed all the way. */
  const path = async (pts, kind = 'pen') => {
    await input('mousePressed', pts[0][0], pts[0][1], kind, 0.5, 1)
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i]
      for (let j = 1; j <= 6; j++) { await input('mouseMoved', ax + (bx - ax) * j / 6, ay + (by - ay) * j / 6, kind, 0.5, 1); await wait(6) }
    }
    const [lx, ly] = pts[pts.length - 1]
    await input('mouseReleased', lx, ly, kind, 0, 0)
    await wait(150)
  }
  const tap = async (x, y, kind = 'pen') => { await input('mousePressed', x, y, kind, 0.5, 1); await input('mouseReleased', x, y, kind, 0, 0); await wait(200) }
  const touch = (type, points) =>
    cdp.sendCommand('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x: Math.round(x), y: Math.round(y), id })) })
  const drag = async (x0, y0, x1, y1) => {
    await touch('touchStart', [[x0, y0]])
    for (let i = 1; i <= 10; i++) { await touch('touchMove', [[x0 + (x1 - x0) * i / 10, y0 + (y1 - y0) * i / 10]]); await wait(16) }
    await touch('touchEnd', []); await wait(300)
  }
  const pinch = async (cx, cy, from, to) => {
    await touch('touchStart', [[cx - from, cy], [cx + from, cy]])
    for (let i = 1; i <= 10; i++) { const d = from + (to - from) * i / 10; await touch('touchMove', [[cx - d, cy], [cx + d, cy]]); await wait(16) }
    await touch('touchEnd', []); await wait(300)
  }
  const wheel = (x, y, deltaY, modifiers = 0) =>
    cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(x), y: Math.round(y), deltaX: 0, deltaY, modifiers })
  const views = () => app.workspace.getLeavesOfType('abele-drawing').map((l) => l.view)
  const q = (view, sel) => view.contentEl.querySelector(sel)
  const click = (view, sel) => q(view, sel).click()
  const box = (view) => view.session.surface.el.getBoundingClientRect()
  const items = (view) => view.session.items.items
  const read = async (path) => { const f = app.vault.getAbstractFileByPath(path); return f ? app.vault.read(f) : null }
  const data = async (path) => { const t = await read(path); const m = /<metadata id="abele-drawing">([\\s\\S]*?)<\\/metadata>/.exec(t ?? ''); return m ? JSON.parse(m[1]).items : null }
  const listen = () => {
    const heard = []
    const types = ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchmove', 'touchend', 'contextmenu', 'wheel']
    const fn = (e) => heard.push(e.type)
    for (const t of types) { document.addEventListener(t, fn); window.addEventListener(t, fn) }
    return { heard, stop: () => { for (const t of types) { document.removeEventListener(t, fn); window.removeEventListener(t, fn) } } }
  }
  const shoot = async (name) => {
    const img = await Promise.race([require('@electron/remote').getCurrentWebContents().capturePage(), wait(8000).then(() => null)])
    if (img) { require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true }); require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/drawing-' + name + '.png', img.toPNG()) }
  }
  const closeAll = async () => { for (const leaf of app.workspace.getLeavesOfType('abele-drawing')) leaf.detach(); await wait(500) }
  const newOne = async () => {
    await until(() => app.workspace.layoutReady, 15000)
    const folder = app.vault.getAbstractFileByPath(DIR)
    await window.__abeleTest.newDrawing(app, folder)
    const view = await until(() => views().find((v) => v.session && v.file && v.model.on && v.session.surface.width > 0), 10000)
    await wait(300)
    return view
  }
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    120_000
  )

describe.skipIf(!available)('the drawing canvas', () => {
  let size: [number, number] = [0, 0]

  beforeAll(() => {
    attachDebugger()
    size = windowSize()
    evalRaw(
      `(async () => {
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        await app.vault.create(${JSON.stringify(`${DIR}/plain.svg`)}, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>')
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  afterAll(async () => {
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-drawing')) leaf.detach()
        for (const leaf of app.workspace.getLeavesOfType('image')) if (leaf.view.file?.path.startsWith(${JSON.stringify(DIR)})) leaf.detach()
        await new Promise((r) => setTimeout(r, 2500))
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

  it('opens a new drawing ready to draw, and the pen leaves a stroke kept in the file with its pressure', () => {
    const r = run<{
      error?: string
      on?: boolean
      fresh?: boolean
      count?: number
      heard?: string[]
      saved?: { tool: string; points: number[] }[] | null
      pressures?: number
      svg?: boolean
    }>(`
      await closeAll()
      const view = await newOne()
      const on = view.model.on
      const fresh = (await read(view.file.path))?.includes('data-abele-drawing') ?? false
      const b = box(view)
      const ears = listen()
      await draw(b.left + 100, b.top + 100, b.left + 400, b.top + 180, 'pen', 0.1, 1)
      ears.stop()
      const count = items(view).length
      // Drawing goes off: what is waiting is written now.
      click(view, '.abele-drawing-bar__mode')
      const saved = await until(async () => { const d = await data(view.file.path); return d?.length ? d : null }, 5000)
      const pressures = new Set((saved?.[0]?.points ?? []).filter((_, i) => i % 3 === 2)).size
      const svg = (await read(view.file.path)).includes('<path d="M')
      window.__drawingPath = view.file.path
      return { on, fresh, count, heard: ears.heard, saved, pressures, svg }
    `)
    expect(r.error).toBeUndefined()
    expect(r.on).toBe(true)
    expect(r.fresh).toBe(true)
    expect(r.count).toBe(1)
    expect(r.heard).toEqual([])
    expect(r.saved?.[0].tool).toBe('pen')
    expect(r.pressures).toBeGreaterThan(3)
    expect(r.svg).toBe(true)
  })

  it('erases, undoes and redoes, and draws with the mouse and the marker', () => {
    const r = run<{
      error?: string
      afterErase?: number
      afterUndo?: number
      afterRedo?: number
      afterUndoAgain?: number
      withMouse?: number
      marker?: string
      saved?: number
    }>(`
      const view = views()[0]
      click(view, '.abele-drawing-bar__mode'); await wait(100)
      click(view, '.abele-drawing-bar__tool_eraser'); await wait(100)
      const b = box(view)
      await draw(b.left + 250, b.top + 60, b.left + 250, b.top + 240, 'pen')
      const afterErase = items(view).length
      click(view, '.abele-drawing-bar__undo'); await wait(100)
      const afterUndo = items(view).length
      click(view, '.abele-drawing-bar__redo'); await wait(100)
      const afterRedo = items(view).length
      click(view, '.abele-drawing-bar__undo'); await wait(100)
      const afterUndoAgain = items(view).length
      click(view, '.abele-drawing-bar__tool_pen'); await wait(100)
      await draw(b.left + 100, b.top + 300, b.left + 300, b.top + 320, 'mouse')
      const withMouse = items(view).length
      click(view, '.abele-drawing-bar__tool_marker'); await wait(100)
      await draw(b.left + 100, b.top + 360, b.left + 300, b.top + 360, 'pen')
      const marker = items(view)[items(view).length - 1]?.tool
      click(view, '.abele-drawing-bar__mode')
      const saved = (await until(async () => { const d = await data(view.file.path); return d?.length === 3 && d }, 5000))?.length
      return { afterErase, afterUndo, afterRedo, afterUndoAgain, withMouse, marker, saved }
    `)
    expect(r.error).toBeUndefined()
    expect(r.afterErase).toBe(0)
    expect(r.afterUndo).toBe(1)
    expect(r.afterRedo).toBe(0)
    expect(r.afterUndoAgain).toBe(1)
    expect(r.withMouse).toBe(2)
    expect(r.marker).toBe('marker')
    expect(r.saved).toBe(3)
  })

  it('moves with a finger and the wheel, zooms with two fingers and Ctrl with the wheel, and tells Obsidian nothing', () => {
    const r = run<{
      error?: string
      dragged?: number
      pinched?: number
      wheeled?: number
      zoomed?: number
      count?: number
      heard?: string[]
    }>(`
      const view = views()[0]
      const b = box(view)
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2
      const ears = listen()
      let c = view.session.camera
      await drag(cx, cy, cx - 150, cy - 50)
      const dragged = view.session.camera.x - c.x
      c = view.session.camera
      await pinch(cx, cy, 60, 120)
      const pinched = view.session.camera.zoom / c.zoom
      c = view.session.camera
      await wheel(cx, cy, 120); await wait(200)
      const wheeled = view.session.camera.y - c.y
      c = view.session.camera
      await wheel(cx, cy, -40, 2); await wait(200)
      const zoomed = view.session.camera.zoom / c.zoom
      ears.stop()
      return { dragged, pinched, wheeled, zoomed, count: items(view).length, heard: ears.heard }
    `)
    expect(r.error).toBeUndefined()
    expect(r.dragged).toBeGreaterThan(100)
    expect(r.pinched).toBeGreaterThan(1.5)
    expect(r.wheeled).toBeGreaterThan(20)
    expect(r.zoomed).toBeGreaterThan(1.1)
    // Nothing drew while it moved.
    expect(r.count).toBe(3)
    expect(r.heard).toEqual([])
  })

  it('comes back in its own tab with what was drawn, from anywhere, while other SVGs stay in Obsidian’s', () => {
    const r = run<{
      error?: string
      type?: string
      count?: number
      plain?: string
      arrived?: number
    }>(`
      const path = window.__drawingPath
      await closeAll()
      const leaf = app.workspace.getLeaf('tab')
      await leaf.openFile(app.vault.getAbstractFileByPath(path))
      const view = await until(() => leaf.view.getViewType() === 'abele-drawing' && leaf.view.session && items(leaf.view).length && leaf.view, 8000)
      const type = leaf.view.getViewType()
      const count = view ? items(view).length : 0
      const other = app.workspace.getLeaf('tab')
      await other.openFile(app.vault.getAbstractFileByPath(DIR + '/plain.svg'))
      await wait(1000)
      const plain = other.view.getViewType()
      other.detach()
      // Another device's copy, with one more stroke, arriving as a change to the file.
      const text = await read(path)
      const meta = /<metadata id="abele-drawing">([\\s\\S]*?)<\\/metadata>/.exec(text)
      const parsed = JSON.parse(meta[1])
      parsed.items.push({ ...parsed.items[0], id: 'fromafar' })
      await app.vault.modify(app.vault.getAbstractFileByPath(path), text.replace(meta[1], JSON.stringify(parsed)))
      const arrived = await until(() => items(view).length === 4 && 4, 5000)
      return { type, count, plain, arrived }
    `)
    expect(r.error).toBeUndefined()
    expect(r.type).toBe('abele-drawing')
    expect(r.count).toBe(3)
    expect(r.plain).toBe('image')
    expect(r.arrived).toBe(4)
  })

  it('picks with the lasso, moves, scales and deletes what is picked, draws shapes and types text', () => {
    const r = run<{
      error?: string
      picked?: number
      moved?: number[]
      scaled?: number
      deleted?: number
      undone?: number
      shapes?: string[]
      field?: boolean
      typed?: string
      saved?: string[]
    }>(`
      await closeAll()
      const view = await newOne()
      const b = box(view)
      const at = (x, y) => [b.left + x, b.top + y]
      await draw(...at(100, 100), ...at(300, 100), 'pen')
      await draw(...at(100, 300), ...at(300, 300), 'pen')
      const first = items(view)[0]
      click(view, '.abele-drawing-bar__tool_lasso'); await wait(100)
      await path([at(80, 60), at(330, 60), at(330, 150), at(80, 150), at(80, 60)])
      const picked = view.model.picked
      const x0 = view.session.items.get(first.id).points[0]
      const y0 = view.session.items.get(first.id).points[1]
      await path([at(200, 100), at(250, 180)])
      const now = view.session.items.get(first.id)
      const moved = [now.points[0] - x0, now.points[1] - y0]
      const bx = view.session.pick.box()
      const z = view.session.camera
      const hx = (bx.x + bx.w - z.x) * z.zoom, hy = (bx.y + bx.h - z.y) * z.zoom
      await path([at(hx, hy), at(hx + (bx.w * z.zoom), hy + (bx.h * z.zoom))])
      const scaled = view.session.items.get(first.id).size / first.size
      click(view, '.abele-drawing-bar__delete'); await wait(100)
      const deleted = items(view).length
      click(view, '.abele-drawing-bar__undo'); await wait(100)
      const undone = items(view).length
      click(view, '.abele-drawing-bar__tool_shape'); await wait(100)
      await draw(...at(400, 100), ...at(500, 180), 'pen')
      view.session.setShape('arrow')
      await draw(...at(400, 250), ...at(520, 320), 'mouse')
      const shapes = items(view).filter((i) => i.type === 'shape').map((i) => i.kind)
      click(view, '.abele-drawing-bar__tool_text'); await wait(100)
      await tap(...at(150, 420))
      const field = !!(await until(() => document.activeElement?.classList.contains('abele-drawing-text')))
      await cdp.sendCommand('Input.insertText', { text: 'Hello there' })
      await wait(100)
      await tap(...at(600, 500))
      await wait(200)
      const typed = items(view).find((i) => i.type === 'text')?.text
      click(view, '.abele-drawing-bar__mode')
      const saved = (await until(async () => { const d = await data(view.file.path); return d?.some((i) => i.type === 'text') && d }, 5000) || []).map((i) => i.type)
      return { picked, moved, scaled, deleted, undone, shapes, field, typed, saved }
    `)
    expect(r.error).toBeUndefined()
    expect(r.picked).toBe(1)
    expect(r.moved![0]).toBeGreaterThan(30)
    expect(r.moved![1]).toBeGreaterThan(50)
    expect(r.scaled).toBeGreaterThan(1.5)
    expect(r.deleted).toBe(1)
    expect(r.undone).toBe(2)
    expect(r.shapes).toEqual(['rect', 'arrow'])
    expect(r.field).toBe(true)
    expect(r.typed).toBe('Hello there')
    expect(r.saved).toEqual(['stroke', 'stroke', 'shape', 'shape', 'text'])
  })

  it('shows the part of a drawing a note names, changes it and keeps it, and opens the drawing there', () => {
    const r = run<{
      error?: string
      reading?: { embed: boolean; hidden: boolean; height: number; width: number; img: number }
      live?: boolean
      kept?: string
      opened?: { type?: string; zoom?: number; on?: boolean }
    }>(`
      await closeAll()
      const path = window.__drawingPath
      const NOTE = DIR + '/Embed note.md'
      const old = app.vault.getAbstractFileByPath(NOTE)
      if (old) await app.vault.delete(old)
      await app.vault.create(NOTE, '# Plan\n\n> [!drawing|100 80 300 150]\n> ![[' + path + ']]\n\nAfter.\n')
      const leaf = app.workspace.getLeaf('tab')
      await leaf.openFile(app.vault.getAbstractFileByPath(NOTE), { state: { mode: 'preview' } })
      const embedEl = await until(() => leaf.view.containerEl.querySelector('.markdown-reading-view .abele-drawing-embed img[src]'), 8000)
      const box = embedEl?.parentElement
      await wait(300)
      const reading = box ? {
        embed: true,
        hidden: getComputedStyle(leaf.view.containerEl.querySelector('.markdown-reading-view .internal-embed.abele-drawing-embed__source')).display === 'none',
        height: box.clientHeight,
        width: box.clientWidth,
        img: embedEl.getBoundingClientRect().width,
      } : null
      // Changed: zoomed in with Ctrl and the wheel over it, kept.
      box.querySelector('.abele-drawing-embed__adjust').click(); await wait(100)
      const br = box.getBoundingClientRect()
      await wheel(br.left + br.width / 2, br.top + br.height / 2, -50, 2); await wait(200)
      box.querySelector('.abele-drawing-embed__keep').click()
      const kept = await until(async () => { const t = await read(NOTE); return !t.includes('[!drawing|100 80 300 150]') && t.split('\n')[2] }, 5000)
      // Live preview draws it too.
      await leaf.setViewState({ type: 'markdown', state: { file: NOTE, mode: 'source', source: false } })
      const live = !!(await until(() => leaf.view.containerEl.querySelector('.markdown-source-view .abele-drawing-embed img[src]'), 8000))
      await leaf.setViewState({ type: 'markdown', state: { file: NOTE, mode: 'preview' } })
      const again = await until(() => leaf.view.containerEl.querySelector('.markdown-reading-view .abele-drawing-embed__open'), 8000)
      again.click()
      const view = await until(() => views().find((v) => v.file?.path === path && v.session?.surface.width), 8000)
      await wait(400)
      const opened = { type: view?.getViewType(), zoom: view?.session.camera.zoom, on: view?.model.on }
      leaf.detach()
      return { reading, live, kept, opened }
    `)
    expect(r.error).toBeUndefined()
    expect(r.reading?.embed).toBe(true)
    expect(r.reading?.hidden).toBe(true)
    // The part is twice as wide as tall, filling the note's width.
    expect(Math.abs(r.reading!.height - r.reading!.width / 2)).toBeLessThan(3)
    expect(r.reading!.img).toBeGreaterThan(r.reading!.width)
    expect(r.kept).toMatch(/^> \[!drawing\|\d+ \d+ \d+ \d+\]$/)
    expect(r.live).toBe(true)
    expect(r.opened?.type).toBe('abele-drawing')
    expect(r.opened?.on).toBe(true)
    expect(r.opened?.zoom).toBeGreaterThan(1)
  })

  it('inserts a new drawing into a note at the cursor and opens it beside the note', () => {
    const r = run<{ error?: string; text?: string; opened?: boolean; file?: boolean }>(`
      await closeAll()
      const NOTE = DIR + '/Insert note.md'
      const old = app.vault.getAbstractFileByPath(NOTE)
      if (old) await app.vault.delete(old)
      const note = await app.vault.create(NOTE, 'Before\n')
      const leaf = app.workspace.getLeaf('tab')
      await leaf.openFile(note, { state: { mode: 'source' } })
      app.workspace.setActiveLeaf(leaf, { focus: true })
      leaf.view.editor.setCursor({ line: 1, ch: 0 })
      app.commands.executeCommandById('abele:insert-drawing')
      const view = await until(() => views().find((v) => v.session?.surface.width && v.model.on), 8000)
      const text = await until(async () => { const t = await read(NOTE); return t.includes('[!drawing]') && t }, 5000)
      const file = !!view?.file && !!app.vault.getAbstractFileByPath(view.file.path)
      const opened = !!view
      if (view) await app.vault.delete(view.file)
      leaf.detach()
      return { text, opened, file }
    `)
    expect(r.error).toBeUndefined()
    expect(r.opened).toBe(true)
    expect(r.file).toBe(true)
    expect(r.text).toMatch(/^Before\n> \[!drawing\]\n> !\[\[.*Drawing .*\.svg\]\]/)
  })

  it('exports a PNG, and shows a drawing to the agent as a picture, all of it or a part', () => {
    const r = run<{
      error?: string
      png?: { path: string; w: number; h: number }
      tool?: { about: string; w: number; h: number }
      part?: { about: string; w: number; h: number }
      read?: string
    }>(`
      await closeAll()
      const path = window.__drawingPath
      const leaf = app.workspace.getLeaf('tab')
      await leaf.openFile(app.vault.getAbstractFileByPath(path))
      const view = await until(() => leaf.view.getViewType() === 'abele-drawing' && leaf.view.session?.surface.width && leaf.view, 8000)
      const size = (url) => new Promise((ok) => { const i = new Image(); i.onload = () => ok([i.naturalWidth, i.naturalHeight]); i.onerror = () => ok([0, 0]); i.src = url })
      const file = await view.exportPng(null)
      const [pw, ph] = await size(app.vault.getResourcePath(file))
      const png = { path: file.path, w: pw, h: ph }
      await app.vault.delete(file)
      const tools = window.__abeleTest.createAgentTools()
      const look = tools.find((t) => t.name === 'look_at_drawing')
      const whole = await look.execute('x', { path })
      const [tw, th] = await size(whole.injectMessages[0].content[1].image_url.url)
      const partR = await look.execute('x', { path, area: '100 80 120 60' })
      const [qw, qh] = await size(partR.injectMessages[0].content[1].image_url.url)
      const { prepareImageForApi } = window.__abeleTest
      const read = prepareImageForApi ? (await prepareImageForApi(path))?.slice(0, 22) : 'no api'
      leaf.detach()
      return { png, tool: { about: whole.content[0].text, w: tw, h: th }, part: { about: partR.content[0].text, w: qw, h: qh }, read }
    `)
    expect(r.error).toBeUndefined()
    expect(r.png!.w).toBeGreaterThan(100)
    expect(r.png!.h).toBeGreaterThan(50)
    expect(r.tool!.about).toContain('shown: all of it')
    expect(r.tool!.w).toBeGreaterThan(100)
    // A small part is enlarged four times.
    expect(r.part!.w).toBe(480)
    expect(r.part!.h).toBe(240)
    expect(r.read).toBe('data:image/png;base64,')
  })

  it('fits its bar on a phone, where a finger draws, and on a tablet, where it moves the drawing', async () => {
    await reload('app.emulateMobile(true)')
    await setWindowSize(390, 844)
    await reload('location.reload()')
    const phone = run<{
      error?: string
      finger?: boolean
      count?: number
      heard?: string[]
      bar?: { left: number; right: number; bottom: number; width: number; surfaceTop: number }
    }>(`
      await closeAll()
      const view = await newOne()
      await wait(400)
      const finger = view.model.finger
      const barEl = q(view, '.abele-drawing-bar')
      const bb = barEl.getBoundingClientRect()
      const b = box(view)
      const ears = listen()
      await drag(b.left + 60, b.top + 120, b.left + 300, b.top + 220)
      ears.stop()
      await shoot('phone')
      const count = items(view).length
      const last = [...barEl.querySelectorAll('.abele-obsidian-icon')].reduce((m, el) => Math.max(m, el.getBoundingClientRect().right), 0)
      return { finger, count, heard: ears.heard, bar: { left: bb.left, right: last, bottom: bb.bottom, width: innerWidth, surfaceTop: b.top } }
    `)
    expect(phone.error).toBeUndefined()
    expect(phone.finger).toBe(true)
    expect(phone.count).toBe(1)
    expect(phone.heard).toEqual([])
    expect(phone.bar!.right).toBeLessThanOrEqual(phone.bar!.width)
    expect(phone.bar!.bottom).toBeLessThanOrEqual(phone.bar!.surfaceTop + 1)

    await setWindowSize(820, 1180)
    await reload('location.reload()')
    const tablet = run<{ error?: string; finger?: boolean; count?: number; moved?: number }>(`
      await closeAll()
      const view = await newOne()
      await wait(400)
      const finger = view.model.finger
      const b = box(view)
      const x0 = view.session.camera.x
      await drag(b.left + 300, b.top + 300, b.left + 100, b.top + 300)
      const moved = view.session.camera.x - x0
      await draw(b.left + 100, b.top + 100, b.left + 400, b.top + 160, 'pen', 0.2, 0.9)
      await shoot('tablet')
      return { finger, count: items(view).length, moved }
    `)
    expect(tablet.error).toBeUndefined()
    expect(tablet.finger).toBe(false)
    expect(tablet.moved).toBeGreaterThan(100)
    expect(tablet.count).toBe(1)
  }, 240_000)
})
