/**
 * Picking, moving and scaling on a drawing in the running app, read off the canvas itself: what
 * was dragged has to be painted where it was let go and nowhere else — at 100%, zoomed in after a
 * pan, zoomed out; with the mouse, the pen and a finger — and stay there once the file is written.
 * A handle taken a little off the corner does not jump, a tap in a box picks it, and two fingers
 * on a phone zoom rather than dragging what is picked twice.
 *
 * The data alone says nothing here: the first of these bugs had every item in the right place
 * while the canvas showed it back where the drag began.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evalRaw, hasTestApi, isObsidianRunning, runCli } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele drawing edit e2e'

const PRELUDE = `
  const DIR = ${JSON.stringify(DIR)}
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 8000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(50) }
    return null
  }
  const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const cdp = require('@electron/remote').getCurrentWebContents().debugger
  const input = (type, x, y, pointerType, buttons) =>
    cdp.sendCommand('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: 'left', buttons, clickCount: 1, pointerType, force: buttons ? 0.5 : 0 })
  const touch = (type, points) =>
    cdp.sendCommand('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x: Math.round(x), y: Math.round(y), id })) })
  /** A line through several points, with the mouse, the pen or a finger. */
  const path = async (pts, kind) => {
    const at = (i, j) => { const [ax, ay] = pts[i - 1], [bx, by] = pts[i]; return [ax + (bx - ax) * j / 8, ay + (by - ay) * j / 8] }
    if (kind === 'touch') {
      await touch('touchStart', [pts[0]])
      for (let i = 1; i < pts.length; i++) for (let j = 1; j <= 8; j++) { await touch('touchMove', [at(i, j)]); await wait(8) }
      await touch('touchEnd', [])
    } else {
      await input('mousePressed', pts[0][0], pts[0][1], kind, 1)
      for (let i = 1; i < pts.length; i++) for (let j = 1; j <= 8; j++) { const [x, y] = at(i, j); await input('mouseMoved', x, y, kind, 1); await wait(8) }
      const [lx, ly] = pts[pts.length - 1]
      await input('mouseReleased', lx, ly, kind, 0)
    }
    await wait(120)
  }
  const tap = (x, y, kind) => path([[x, y], [x, y]], kind)
  const views = () => app.workspace.getLeavesOfType('abele-drawing').map((l) => l.view)
  const click = (view, sel) => view.contentEl.querySelector(sel).click()
  const closeAll = async () => { for (const leaf of app.workspace.getLeavesOfType('abele-drawing')) leaf.detach(); await wait(400) }
  const newOne = async () => {
    await until(() => app.workspace.layoutReady, 15000)
    await window.__abeleTest.newDrawing(app, app.vault.getAbstractFileByPath(DIR))
    const view = await until(() => views().find((v) => v.session && v.file && v.model.on && v.session.surface.width > 0), 10000)
    await wait(300)
    return view
  }
  /** Whether the canvas has ink within two pixels of a point of the surface. */
  const inkAt = (view, x, y) => {
    const canvas = view.session.surface.el.querySelector('.abele-drawing-surface__canvas:not(.abele-drawing-surface__canvas_live)')
    const r = window.devicePixelRatio || 1
    const d = canvas.getContext('2d').getImageData(Math.round((x - 2) * r), Math.round((y - 2) * r), Math.round(5 * r), Math.round(5 * r)).data
    for (let i = 3; i < d.length; i += 4) if (d[i] > 40) return true
    return false
  }
  const shapeOf = (view) => view.session.items.items.find((i) => i.type === 'shape')
  const saved = async (view) => {
    const t = await app.vault.read(view.file)
    const m = /<metadata id="abele-drawing">([\\s\\S]*?)<\\/metadata>/.exec(t)
    return m ? JSON.parse(m[1]).items : []
  }
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    120_000
  )

interface MoveResult {
  error?: string
  picked?: number
  moved?: [number, number]
  newEdge?: boolean
  oldEdge?: boolean
  newEdgeLater?: boolean
  oldEdgeLater?: boolean
  savedX1?: number
}

/**
 * A box drawn, picked with a loop, dragged by 120, 80 on screen with one kind of pointer and
 * a camera; read off the canvas right after, and again after the file is written.
 */
const moveWith = (kind: string, camera: string, finger = false): MoveResult =>
  run<MoveResult>(`
    await closeAll()
    const view = await newOne()
    const s = view.session
    ${finger ? 's.setFinger(true)' : ''}
    s.setCamera(${camera}); await frames()
    const b = s.surface.el.getBoundingClientRect()
    const at = (x, y) => [b.left + x, b.top + y]
    s.setShape('rect')
    await path([at(150, 150), at(250, 220)], ${JSON.stringify(kind)})
    s.setTool('lasso')
    await path([at(120, 120), at(290, 120), at(290, 250), at(120, 250), at(120, 120)], ${JSON.stringify(kind)})
    const picked = view.model.picked
    const before = shapeOf(view)
    await path([at(200, 150), at(260, 190), at(320, 230)], ${JSON.stringify(kind)})
    await frames()
    const after = shapeOf(view)
    const z = s.camera.zoom
    const moved = [(after.x1 - before.x1) * z, (after.y1 - before.y1) * z]
    const newEdge = inkAt(view, 270, 265)
    const oldEdge = inkAt(view, 150, 185)
    await wait(2600)
    await frames()
    const newEdgeLater = inkAt(view, 270, 265)
    const oldEdgeLater = inkAt(view, 150, 185)
    const savedX1 = (await saved(view)).find((i) => i.type === 'shape')?.x1
    return { picked, moved, newEdge, oldEdge, newEdgeLater, oldEdgeLater, savedX1: savedX1 === undefined ? undefined : (savedX1 - before.x1) * z }
  `)

const expectMoved = (r: MoveResult): void => {
  expect(r.error).toBeUndefined()
  expect(r.picked).toBe(1)
  expect(r.moved![0]).toBeCloseTo(120, -0.5)
  expect(r.moved![1]).toBeCloseTo(80, -0.5)
  // On the canvas where it was let go, and not where it was.
  expect(r.newEdge).toBe(true)
  expect(r.oldEdge).toBe(false)
  // And still so once the file is written and heard back from.
  expect(r.newEdgeLater).toBe(true)
  expect(r.oldEdgeLater).toBe(false)
  expect(r.savedX1).toBeCloseTo(120, -0.5)
}

describe.skipIf(!available)('picking, moving and scaling on a drawing', () => {
  beforeAll(() => {
    runCli(['dev:debug', 'on'], 30_000)
    evalRaw(
      `(async () => {
        require('@electron/remote').getCurrentWebContents().setBackgroundThrottling(false)
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  afterAll(() => {
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-drawing')) leaf.detach()
        await new Promise((r) => setTimeout(r, 2500))
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  it('shows what the mouse moved where it was let go, at 100%', () => {
    expectMoved(moveWith('mouse', '{ x: 0, y: 0, zoom: 1 }'))
  })

  it('shows what the pen moved where it was let go, zoomed in after a pan', () => {
    expectMoved(moveWith('pen', '{ x: -40, y: 25, zoom: 2 }'))
  })

  it('shows what the pen moved where it was let go, zoomed out', () => {
    expectMoved(moveWith('pen', '{ x: 30, y: -60, zoom: 0.5 }'))
  })

  it('shows what a finger moved where it was let go, drawing with a finger', () => {
    expectMoved(moveWith('touch', '{ x: 10, y: 10, zoom: 1.5 }', true))
  })

  it('scales from a handle taken off its corner without a jump, and picks a box by a tap inside it', () => {
    const r = run<{ error?: string; tapped?: number; k?: number; still?: number }>(`
      await closeAll()
      const view = await newOne()
      const s = view.session
      s.setCamera({ x: 0, y: 0, zoom: 1.5 }); await frames()
      const b = s.surface.el.getBoundingClientRect()
      const at = (x, y) => [b.left + x, b.top + y]
      s.setShape('rect')
      await path([at(200, 200), at(245, 230)], 'mouse')
      s.setTool('lasso')
      await tap(...at(222, 215), 'mouse')
      const tapped = view.model.picked
      const box = s.pick.box()
      const z = s.camera.zoom
      const size = shapeOf(view).x2 - shapeOf(view).x1
      // The handle, taken 7 pixels past its corner.
      const hx = (box.x + box.w) * z + 7, hy = (box.y + box.h) * z + 7
      await path([at(hx, hy), at(hx + 2, hy + 1)], 'mouse')
      const still = (shapeOf(view).x2 - shapeOf(view).x1) / size
      // Pulled as far again as the grip is from the box's top left: twice the size.
      const gx = hx - box.x * z, gy = hy - box.y * z
      await path([at(hx, hy), at(hx + gx / 2, hy + gy / 2), at(hx + gx, hy + gy)], 'mouse')
      const k = (shapeOf(view).x2 - shapeOf(view).x1) / size
      return { tapped, k, still }
    `)
    expect(r.error).toBeUndefined()
    expect(r.tapped).toBe(1)
    expect(r.still).toBe(1)
    expect(r.k).toBeGreaterThan(1.97)
    expect(r.k).toBeLessThan(2.03)
  })

  it('zooms with two fingers, drawing with a finger, and moves nothing picked or draws', () => {
    const r = run<{ error?: string; zoom?: number; x1?: number; count?: number }>(`
      await closeAll()
      const view = await newOne()
      const s = view.session
      s.setFinger(true)
      const b = s.surface.el.getBoundingClientRect()
      const at = (x, y) => [b.left + x, b.top + y]
      s.setShape('rect')
      await path([at(150, 150), at(250, 220)], 'touch')
      s.setTool('lasso')
      await path([at(120, 120), at(290, 120), at(290, 250), at(120, 250), at(120, 120)], 'touch')
      const x1 = shapeOf(view).x1
      const [cx, cy] = at(200, 185)
      await touch('touchStart', [[cx - 30, cy]]); await wait(30)
      await touch('touchStart', [[cx - 30, cy], [cx + 30, cy]])
      for (let i = 1; i <= 10; i++) { const d = 30 + 6 * i; await touch('touchMove', [[cx - d, cy], [cx + d, cy]]); await wait(16) }
      await touch('touchEnd', []); await wait(300)
      return { zoom: s.camera.zoom, x1: shapeOf(view).x1 - x1, count: s.items.items.length }
    `)
    expect(r.error).toBeUndefined()
    expect(r.zoom).toBeGreaterThan(1.5)
    expect(r.x1).toBe(0)
    expect(r.count).toBe(1)
  })
})
