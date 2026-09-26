/**
 * A large drawing in the running app: five thousand handwritten-looking strokes over a wide
 * sheet. How big its file is, how long it takes to open, to paint whole and in part, to write,
 * and how smoothly it moves — measured and printed, and held to limits well above what a desktop
 * does so a regression that makes it crawl is caught. An iPad is slower; the numbers printed are
 * what to compare it with.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele drawing perf e2e'
const FILE = `${DIR}/big.svg`

interface Numbers {
  error?: string
  strokes: number
  bytes: number
  writeMs: number
  openMs: number
  firstPaintMs: number
  paintMs: number
  closePaintMs: number
  painted: number
  panFrameMs: number
  zoomFrameMs: number
  eraseMs: number
}

describe.skipIf(!available)('a drawing of five thousand strokes', () => {
  beforeAll(() => {
    evalRaw(
      `(async () => {
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
        await new Promise((r) => setTimeout(r, 1500))
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  it('opens, paints, moves and saves in reasonable time', () => {
    const n = evalAsync<Numbers>(
      `(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const frame = () => new Promise((r) => requestAnimationFrame(r))
        try {
          // Lines of "handwriting": wavy strokes of about forty points, in rows across the sheet.
          let seed = 7
          const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
          const items = []
          for (let i = 0; i < 5000; i++) {
            const row = Math.floor(i / 50), col = i % 50
            const x0 = col * 60 + rnd() * 10, y0 = row * 40 + rnd() * 10
            const points = []
            for (let k = 0; k < 40; k++) {
              const t = k / 39
              points.push(Math.round((x0 + t * 45) * 10) / 10, Math.round((y0 + Math.sin(t * 9 + i) * 8 + rnd() * 2) * 10) / 10, Math.round((0.3 + 0.5 * rnd()) * 100) / 100)
            }
            items.push({ id: 's' + i, type: 'stroke', tool: i % 17 ? 'pen' : 'marker', color: i % 17 ? 'black' : 'yellow', size: i % 17 ? 2.4 : 14, points })
          }
          // Written the way the tab writes it.
          const leaf = app.workspace.getLeaf('tab')
          const probe = await app.vault.create(${JSON.stringify(`${DIR}/probe.svg`)}, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" data-abele-drawing="1"></svg>')
          await leaf.openFile(probe)
          const pv = await (async () => { for (let i = 0; i < 100; i++) { if (leaf.view.getViewType() === 'abele-drawing' && leaf.view.session) return leaf.view; await wait(50) } })()
          pv.session.load(items)
          let t = performance.now()
          const text = pv.getViewData()
          const writeMs = performance.now() - t
          leaf.detach()
          await app.vault.create(${JSON.stringify(FILE)}, text)
          await wait(300)

          // Opened as a person opens it.
          const leaf2 = app.workspace.getLeaf('tab')
          t = performance.now()
          await leaf2.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(FILE)}))
          let view
          for (let i = 0; i < 400; i++) { if (leaf2.view.getViewType() === 'abele-drawing' && leaf2.view.session?.items.items.length === 5000 && leaf2.view.session.surface.renderer.lastPainted) { view = leaf2.view; break } await wait(10) }
          const openMs = performance.now() - t
          const s = view.session, r = s.surface.renderer
          const firstPaintMs = r.lastPaintMs
          s.paint()
          const paintMs = r.lastPaintMs
          const painted = r.lastPainted

          // Moving: sixty frames of a drag, then of a zoom.
          const drag = async (step) => {
            const t0 = performance.now()
            for (let i = 0; i < 60; i++) { step(i); await frame() }
            return (performance.now() - t0) / 60
          }
          const c0 = s.camera
          const panFrameMs = await drag(() => s.setCamera({ ...s.camera, x: s.camera.x + 20 / s.camera.zoom }))
          s.setCamera(c0)
          const zoomFrameMs = await drag((i) => s.zoomBy(i < 30 ? 1.03 : 1 / 1.03))
          await wait(400)

          // Close up: most of it out of view.
          s.setCamera({ x: 1000, y: 1000, zoom: 2 })
          await wait(300)
          s.paint()
          const closePaintMs = r.lastPaintMs

          // One pass of the eraser across a row of the close-up.
          s.start(); s.setTool('eraser')
          const box = s.surface.el.getBoundingClientRect()
          const cdp = require('@electron/remote').getCurrentWebContents().debugger
          try { cdp.attach('1.3') } catch {}
          const input = (type, x, y, buttons) => cdp.sendCommand('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: 'left', buttons, clickCount: 1, pointerType: 'pen', force: 0.5 })
          t = performance.now()
          await input('mousePressed', box.left + 20, box.top + 100, 1)
          for (let i = 1; i <= 30; i++) await input('mouseMoved', box.left + 20 + i * 20, box.top + 100, 1)
          await input('mouseReleased', box.left + 620, box.top + 100, 0)
          const eraseMs = performance.now() - t
          s.undo()
          s.stop()
          return { strokes: s.items.items.length, bytes: text.length, writeMs, openMs, firstPaintMs, paintMs, closePaintMs, painted, panFrameMs, zoomFrameMs, eraseMs }
        } catch (e) { return { error: String(e && e.stack || e) } }
      })()`,
      170_000
    )
    console.log('[drawing perf]', JSON.stringify(n))
    expect(n.error).toBeUndefined()
    expect(n.strokes).toBe(5000)
    // Limits well above a desktop's numbers: a slide into seconds is what they catch.
    expect(n.openMs).toBeLessThan(5000)
    expect(n.paintMs).toBeLessThan(250)
    expect(n.closePaintMs).toBeLessThan(60)
    expect(n.panFrameMs).toBeLessThan(60)
    expect(n.zoomFrameMs).toBeLessThan(60)
    expect(n.writeMs).toBeLessThan(1500)
    expect(n.bytes).toBeLessThan(12_000_000)
  }, 180_000)
})
