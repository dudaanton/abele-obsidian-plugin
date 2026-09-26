/**
 * A drawing shown in a note, in the running app: embedded the plain way (`![[Sketch.svg]]`) as
 * well as through its callout, in reading view and live preview, it draws what is on the drawing —
 * counted in the pixels of the screen, not in the markup — at the drawing's own size, and follows
 * a stroke drawn after it. Two embeds of one drawing in a note are sized apart: a size named in the
 * link, a handle dragged and written back into the embed dragged, a part kept into the callout it
 * was changed in. A button on every embed, seen without hovering, opens the drawing.
 *
 * Pictures go to `/tmp/abele-phone/drawing-embed-*.png` — look at them.
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

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele drawing embed e2e'
const SHOTS = '/tmp/abele-phone'

const attachDebugger = (): void => void runCli(['dev:debug', 'on'], 30_000)

const PRELUDE = `
  const DIR = ${JSON.stringify(DIR)}
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 8000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(50) }
    return null
  }
  const wc = require('@electron/remote').getCurrentWebContents()
  const cdp = wc.debugger
  const input = (type, x, y, pointerType, buttons) =>
    cdp.sendCommand('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: 'left', buttons, clickCount: 1, pointerType, force: 0.5 })
  const stroke = async (pts, kind = 'pen') => {
    await input('mousePressed', pts[0][0], pts[0][1], kind, 1)
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i]
      for (let j = 1; j <= 6; j++) { await input('mouseMoved', ax + (bx - ax) * j / 6, ay + (by - ay) * j / 6, kind, 1); await wait(6) }
    }
    const [lx, ly] = pts[pts.length - 1]
    await input('mouseReleased', lx, ly, kind, 0)
    await wait(150)
  }
  const touch = (type, points) =>
    cdp.sendCommand('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x: Math.round(x), y: Math.round(y), id })) })
  const read = async (path) => { const f = app.vault.getAbstractFileByPath(path); return f ? app.vault.read(f) : null }
  const views = () => app.workspace.getLeavesOfType('abele-drawing').map((l) => l.view)
  const shoot = async (name) => {
    const img = await Promise.race([wc.capturePage(), wait(8000).then(() => null)])
    if (img) { require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true }); require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/drawing-embed-' + name + '.png', img.toPNG()) }
  }
  /** The pixels of ink in an element on the screen: dark ones on the white paper. */
  const ink = async (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return 0
    const img = await wc.capturePage({ x: Math.round(r.left) + 1, y: Math.round(r.top) + 1, width: Math.round(r.width) - 2, height: Math.round(r.height) - 2 })
    const bmp = img.toBitmap()
    let n = 0
    for (let i = 0; i < bmp.length; i += 4) if (bmp[i] + bmp[i + 1] + bmp[i + 2] < 300) n++
    return n
  }
  const note = async (name, text, mode) => {
    const path = DIR + '/' + name + '.md'
    const old = app.vault.getAbstractFileByPath(path)
    if (old) await app.vault.modify(old, text); else await app.vault.create(path, text)
    const leaf = app.workspace.getLeaf('tab')
    await leaf.setViewState({ type: 'markdown', state: { file: path, mode, source: false }, active: true })
    await wait(300)
    return leaf
  }
  const boxes = (leaf) => [...leaf.view.containerEl.querySelectorAll(leaf.view.getMode() === 'preview' ? '.markdown-reading-view .abele-drawing-embed' : '.markdown-source-view .abele-drawing-embed')]
  const closeAll = async () => {
    for (const type of ['abele-drawing', 'markdown']) for (const leaf of app.workspace.getLeavesOfType(type)) leaf.detach()
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

describe.skipIf(!available)('a drawing in a note', () => {
  beforeAll(() => {
    attachDebugger()
    const r = run<{ error?: string; name?: string }>(`
      const old = app.vault.getAbstractFileByPath(DIR)
      if (old) await app.vault.delete(old, true)
      await app.vault.createFolder(DIR)
      await closeAll()
      await window.__abeleTest.newDrawing(app, app.vault.getAbstractFileByPath(DIR))
      const view = await until(() => views().find((v) => v.session && v.file && v.model.on && v.session.surface.width > 0), 10000)
      await wait(300)
      const b = view.session.surface.el.getBoundingClientRect()
      await stroke([[b.left + 120, b.top + 120], [b.left + 200, b.top + 200], [b.left + 280, b.top + 120], [b.left + 360, b.top + 200]])
      view.contentEl.querySelector('.abele-drawing-bar__mode').click()
      await until(async () => (await read(view.file.path)).includes('<path d="M'), 5000)
      window.__embedDrawing = view.file.path
      return { name: view.file.name }
    `)
    if (r.error) throw new Error(r.error)
  }, 90_000)

  afterAll(async () => {
    evalRaw(
      `(async () => {
        for (const type of ['abele-drawing', 'markdown']) for (const leaf of app.workspace.getLeavesOfType(type)) leaf.detach()
        await new Promise((r) => setTimeout(r, 2500))
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        return 'ok'
      })()`,
      60_000
    )
    if (evalJson<boolean>('app.isMobile')) {
      await reloadApp('app.emulateMobile(false)')
      attachDebugger()
    }
  }, 180_000)

  it('keeps what was drawn when the tab is closed right after, and the note shows it', () => {
    const r = run<{ error?: string; kept?: boolean; ink?: number }>(`
      await closeAll()
      await window.__abeleTest.newDrawing(app, app.vault.getAbstractFileByPath(DIR))
      const view = await until(() => views().find((v) => v.session && v.file && v.model.on && v.session.surface.width > 0), 10000)
      await wait(300)
      const file = view.file
      const b = view.session.surface.el.getBoundingClientRect()
      await stroke([[b.left + 100, b.top + 100], [b.left + 300, b.top + 160], [b.left + 120, b.top + 220]])
      view.contentEl.querySelector('.abele-drawing-bar__mode').click()
      await until(async () => (await read(file.path)).includes('<path d="M'), 5000)
      // Closed at once: the save still waiting must not write an empty drawing after it.
      view.leaf.detach()
      await wait(3000)
      const kept = (await read(file.path)).includes('<path d="M')
      const leaf = await note('Closed', '![[' + file.name + ']]\\n', 'preview')
      const box = await until(() => boxes(leaf).find((x) => x.querySelector('img')?.complete && x.clientWidth), 8000)
      await wait(400)
      return { kept, ink: box ? await ink(box) : 0 }
    `)
    expect(r.error).toBeUndefined()
    expect(r.kept).toBe(true)
    expect(r.ink).toBeGreaterThan(100)
  })

  it('draws what is drawn when embedded the plain way, at its own size, and follows a new stroke', () => {
    const r = run<{
      error?: string
      live?: { ink: number; w: number; h: number; room: number; paper: number; native: number }
      after?: { ink: number; src: boolean }
      reading?: { ink: number; w: number }
    }>(`
      await closeAll()
      const path = window.__embedDrawing
      const file = app.vault.getAbstractFileByPath(path)
      const paper = Number(/viewBox="[-\\d.]+ [-\\d.]+ ([\\d.]+)/.exec(await read(path))[1])
      const leaf = await note('Plain', '# Plain\\n\\n![[' + file.name + ']]\\n\\nAfter.\\n', 'source')
      const box = await until(() => boxes(leaf).find((b) => b.querySelector('img')?.complete && b.clientWidth), 8000)
      await wait(500)
      // Obsidian's own picture of the file is not what shows.
      const native = [...leaf.view.containerEl.querySelectorAll('.internal-embed img')].filter((i) => !i.closest('.abele-drawing-embed') && i.getBoundingClientRect().height > 0).length
      const live = box && { ink: await ink(box), w: box.clientWidth, h: box.clientHeight, room: leaf.view.containerEl.querySelector('.cm-content').clientWidth, paper, native }
      await shoot('plain-live')
      // A stroke drawn with the note open beside the drawing shows in the note.
      const src = box.querySelector('img').src
      await app.workspace.getLeaf('split').openFile(file)
      const view = await until(() => views().find((v) => v.file?.path === path && v.session?.surface.width), 8000)
      await wait(400)
      view.contentEl.querySelector('.abele-drawing-bar__mode').click()
      await wait(200)
      const b = view.session.surface.el.getBoundingClientRect()
      await stroke([[b.left + 60, b.top + 300], [b.left + 300, b.top + 330], [b.left + 60, b.top + 360], [b.left + 300, b.top + 390]])
      const moved = await until(() => { const now = boxes(leaf)[0]; return now && now.querySelector('img').src !== src && now }, 8000)
      await wait(600)
      const after = { ink: moved ? await ink(moved) : 0, src: !!moved }
      await shoot('plain-live-after')
      view.leaf.detach()
      await leaf.setViewState({ type: 'markdown', state: { file: leaf.view.file.path, mode: 'preview' } })
      const rb = await until(() => boxes(leaf).find((b) => b.querySelector('img')?.complete && b.clientWidth), 8000)
      await wait(500)
      const reading = rb && { ink: await ink(rb), w: rb.clientWidth }
      await shoot('plain-reading')
      return { live, after, reading }
    `)
    expect(r.error).toBeUndefined()
    expect(r.live?.native).toBe(0)
    expect(r.live!.ink).toBeGreaterThan(100)
    // At the drawing's own size, not blown up to the note's width.
    expect(r.live!.w).toBeLessThanOrEqual(r.live!.paper + 1)
    expect(r.live!.w).toBeLessThan(r.live!.room)
    expect(r.live!.h).toBeGreaterThan(40)
    expect(r.after?.src).toBe(true)
    expect(r.after!.ink).toBeGreaterThan(r.live!.ink * 1.3)
    expect(r.reading!.ink).toBeGreaterThan(100)
  })

  it('sizes two embeds of one drawing apart, by the link and by the handle kept into the one dragged', () => {
    const r = run<{
      error?: string
      named?: number
      text?: string
      dragged?: number
      other?: number
      parts?: string[]
    }>(`
      await closeAll()
      const file = app.vault.getAbstractFileByPath(window.__embedDrawing)
      const leaf = await note('Twice', 'Twice\\n\\n![[' + file.name + '|150]]\\n\\n![[' + file.name + ']]\\n', 'source')
      const both = await until(() => { const b = boxes(leaf); return b.length === 2 && b.every((x) => x.clientWidth) && b }, 8000)
      await wait(400)
      const named = both[0].clientWidth
      const other = both[1].clientWidth
      const h = both[1].querySelector('.abele-drawing-embed__resize').getBoundingClientRect()
      const x = h.left + h.width / 2, y = h.top + h.height / 2
      await input('mousePressed', x, y, 'mouse', 1)
      for (let i = 1; i <= 8; i++) { await input('mouseMoved', x - i * 10, y, 'mouse', 1); await wait(16) }
      await input('mouseReleased', x - 80, y, 'mouse', 0)
      const text = await until(async () => { const t = await read(leaf.view.file.path); return /\\|\\d+\\]\\]\\n$/.test(t) && t }, 5000)
      await wait(600)
      const now = boxes(leaf)
      const dragged = now[1]?.clientWidth
      await shoot('twice')
      // Two callouts naming the same part: the part kept goes into the one it was changed in.
      const callout = '> [!drawing]\\n> ![[' + file.name + ']]\\n'
      const cl = await note('Twice callouts', 'Callouts\\n\\n' + callout + '\\n' + callout, 'source')
      const cb = await until(() => { const b = boxes(cl); return b.length === 2 && b.every((x) => x.clientWidth) && b }, 8000)
      await wait(300)
      cb[1].querySelector('.abele-drawing-embed__adjust').click(); await wait(100)
      const br = cb[1].getBoundingClientRect()
      await cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(br.left + br.width / 2), y: Math.round(br.top + br.height / 2), deltaX: 0, deltaY: -50, modifiers: 2 })
      await wait(200)
      cb[1].querySelector('.abele-drawing-embed__keep').click()
      const t2 = await until(async () => { const t = await read(cl.view.file.path); return t.includes('[!drawing|') && t }, 5000)
      const parts = (t2 || '').split('\\n').filter((l) => l.startsWith('> [!drawing'))
      return { named, other, text, dragged, parts }
    `)
    expect(r.error).toBeUndefined()
    expect(r.named).toBe(150)
    expect(r.text).toContain(`|150]]`)
    const kept = Number(/\|(\d+)\]\]\n$/.exec(r.text!)![1])
    expect(Math.abs(kept - (r.other! - 80))).toBeLessThan(4)
    expect(Math.abs(r.dragged! - kept)).toBeLessThan(2)
    expect(r.parts?.[0]).toBe('> [!drawing]')
    expect(r.parts?.[1]).toMatch(/^> \[!drawing\|\d+ \d+ \d+ \d+\]$/)
  })

  it('opens the drawing from a button seen without hovering, a part at that part, on a phone too', async () => {
    const desk = run<{
      error?: string
      seen?: boolean
      opened?: string
      zoom?: number
      plain?: string
    }>(`
      await closeAll()
      const file = app.vault.getAbstractFileByPath(window.__embedDrawing)
      const leaf = await note('Open', '> [!drawing|100 100 120 60]\\n> ![[' + file.name + ']]\\n\\n![[' + file.name + ']]\\n', 'preview')
      const b = await until(() => { const b = boxes(leaf); return b.length === 2 && b.every((x) => x.clientWidth) && b }, 8000)
      const go = b[0].querySelector('.abele-drawing-embed__go')
      const seen = !!go && go.getBoundingClientRect().width > 10 && getComputedStyle(go).opacity === '1' && getComputedStyle(go.parentElement).opacity === '1'
      go.click()
      const view = await until(() => views().find((v) => v.file?.path === file.path && v.session?.surface.width), 8000)
      await wait(400)
      const zoom = view?.session.camera.zoom
      view?.leaf.detach()
      b[1].querySelector('.abele-drawing-embed__go').click()
      const plain = (await until(() => views().find((v) => v.file?.path === file.path), 8000))?.file.path
      return { seen, opened: view?.file.path, zoom, plain }
    `)
    expect(desk.error).toBeUndefined()
    expect(desk.seen).toBe(true)
    expect(desk.opened).toMatch(/\.svg$/)
    // The part is 120 wide: it opens zoomed in on it.
    expect(desk.zoom).toBeGreaterThan(1.5)
    expect(desk.plain).toBe(desk.opened)

    await reloadApp('app.emulateMobile(true)')
    attachDebugger()
    const phone = run<{ error?: string; seen?: boolean; opened?: boolean }>(`
      await until(() => app.workspace.layoutReady, 15000)
      await closeAll()
      const file = app.vault.getAbstractFileByPath(window.__embedDrawing ?? app.vault.getFiles().find((f) => f.path.startsWith(DIR) && f.extension === 'svg').path)
      const leaf = await note('Open phone', '![[' + file.name + ']]\\n', 'source')
      const box = await until(() => boxes(leaf).find((x) => x.clientWidth), 8000)
      await wait(400)
      const go = box.querySelector('.abele-drawing-embed__go')
      const r = go.getBoundingClientRect()
      const seen = r.width >= 20 && getComputedStyle(go.parentElement).opacity === '1'
      await shoot('phone')
      await touch('touchStart', [[r.left + r.width / 2, r.top + r.height / 2]])
      await touch('touchEnd', [])
      const opened = !!(await until(() => views().find((v) => v.file?.path === file.path), 8000))
      return { seen, opened }
    `)
    expect(phone.error).toBeUndefined()
    expect(phone.seen).toBe(true)
    expect(phone.opened).toBe(true)
  }, 180_000)

  it('keeps a part moved with a finger in a callout on a phone, and the callout’s size dragged there', async () => {
    if (!evalJson<boolean>('app.isMobile')) {
      await reloadApp('app.emulateMobile(true)')
      attachDebugger()
    }
    const r = run<{ error?: string; header?: string; open?: boolean; text?: string }>(`
      await until(() => app.workspace.layoutReady, 15000)
      await closeAll()
      const file = app.vault.getAbstractFileByPath(window.__embedDrawing ?? app.vault.getFiles().find((f) => f.path.startsWith(DIR) && f.extension === 'svg').path)
      const leaf = await note('Finger', 'Finger\\n\\n> [!drawing]\\n> ![[' + file.name + ']]\\n', 'source')
      const box = await until(() => boxes(leaf).find((x) => x.clientWidth), 8000)
      await wait(400)
      const tap = async (el) => {
        const r = el.getBoundingClientRect()
        await touch('touchStart', [[r.left + r.width / 2, r.top + r.height / 2]])
        await wait(30)
        await touch('touchEnd', [])
        await wait(200)
      }
      await tap(box.querySelector('.abele-drawing-embed__adjust'))
      const b = box.getBoundingClientRect()
      const x = b.left + b.width / 3, y = b.top + b.height / 2
      await touch('touchStart', [[x, y]])
      for (let i = 1; i <= 8; i++) { await touch('touchMove', [[x + i * 8, y + i * 4]]); await wait(16) }
      await touch('touchEnd', [])
      await wait(200)
      await tap(box.querySelector('.abele-drawing-embed__keep'))
      const kept = await until(async () => { const t = await read(leaf.view.file.path); return t.includes('[!drawing|') && t }, 5000)
      const header = (kept || '').split('\\n').find((l) => l.startsWith('> [!drawing'))
      const open = !!box.querySelector('.abele-drawing-embed__keep')
      await wait(600)
      const now = await until(() => boxes(leaf).find((x) => x.clientWidth && !x.matches('.abele-drawing-embed_adjusting')), 8000)
      await shoot('phone-callout')
      const h = now.querySelector('.abele-drawing-embed__resize').getBoundingClientRect()
      const hx = h.left + h.width / 2, hy = h.top + h.height / 2
      await touch('touchStart', [[hx, hy]])
      for (let i = 1; i <= 8; i++) { await touch('touchMove', [[hx - i * 10, hy]]); await wait(16) }
      await touch('touchEnd', [])
      const text = await until(async () => { const t = await read(leaf.view.file.path); return /\\|\\d+\\]\\]\\n$/.test(t) && t }, 5000)
      return { header, open, text }
    `)
    expect(r.error).toBeUndefined()
    expect(r.header).toMatch(/^> \[!drawing\|-?\d+ -?\d+ \d+ \d+\]$/)
    expect(r.open).toBe(false)
    expect(r.text).toMatch(/\|\d+\]\]\n$/)
  }, 180_000)
})
