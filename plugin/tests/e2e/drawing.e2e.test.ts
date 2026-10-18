/** Picture-editor saving and shared stylus geometry retained from the legacy drawing tier. */
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
import { shotDir } from './helpers/shots'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele drawing e2e'
const SHOTS = shotDir('abele-phone')

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
  const views = () => app.workspace.getLeavesOfType('abele-image-ink').map((l) => l.view)
  const q = (view, sel) => view.contentEl.querySelector(sel)
  const click = (view, sel) => q(view, sel).click()
  /** Picks an item of the Obsidian menu open now by its title; false when there is none. */
  const pickMenu = async (title) => {
    const item = await until(() => [...document.querySelectorAll('.menu .menu-item')].find((el) => el.querySelector('.menu-item-title')?.textContent.trim() === title), 3000)
    if (!item) { document.querySelector('.menu')?.remove(); return false }
    item.click()
    await wait(150)
    return true
  }
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
  const closeAll = async () => { for (const leaf of app.workspace.getLeavesOfType('abele-image-ink')) leaf.detach(); await wait(500) }
  const newOne = async () => {
    await until(() => app.workspace.layoutReady, 15000)
    const file = DIR + "/sample-smoothing.png"
    if (!app.vault.getAbstractFileByPath(file)) {
      const canvas = document.createElement("canvas");canvas.width=800;canvas.height=600
      const blob=await new Promise(resolve=>canvas.toBlob(resolve))
      await app.vault.createBinary(file,await blob.arrayBuffer())
    }
    await window.__abeleTest.openImageInk(app,file,"")
    const view=await until(()=>app.workspace.getLeavesOfType("abele-image-ink").map(l=>l.view).find(v=>v.getState().path===file&&v.session?.surface.width&&v.editor.width),10000)
    if(!view)throw Error("Picture editor did not become ready")
    view.session.start()
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

describe.skipIf(!available)('the picture editor and shared ink', () => {
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
    evalAsync(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-image-ink'))
          if (leaf.view.getState().path?.startsWith(${JSON.stringify(DIR + '/')})) leaf.detach()
        for (const leaf of app.workspace.getLeavesOfType('image')) if (leaf.view.file?.path.startsWith(${JSON.stringify(DIR)})) leaf.detach()
        await app.workspace.requestSaveLayout.run()
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

  it('draws on a picture, and saves it as a new one, over the old one, or sends it to the chat', () => {
    const r = run<{
      error?: string
      fresh?: { w: number; h: number; changed: boolean }
      over?: boolean
      chat?: string[] | string
    }>(`
      await closeAll()
      app.workspace.getLeavesOfType('abele-image-ink').forEach((l) => l.detach())
      const PIC = DIR + '/picture.png'
      // A plain grey picture, 300×200.
      const c = document.createElement('canvas'); c.width = 300; c.height = 200
      const g = c.getContext('2d'); g.fillStyle = '#cccccc'; g.fillRect(0, 0, 300, 200)
      const bytes = await new Promise((ok) => c.toBlob((b) => b.arrayBuffer().then(ok), 'image/png'))
      const old = app.vault.getAbstractFileByPath(PIC); if (old) await app.vault.delete(old)
      const pic = await app.vault.createBinary(PIC, bytes)
      await window.__abeleTest.openImageInk(app, PIC, '')
      const view = await until(() => app.workspace.getLeavesOfType('abele-image-ink')[0]?.view?.session?.backdrop && app.workspace.getLeavesOfType('abele-image-ink')[0].view, 8000)
      await wait(300)
      const b = view.session.surface.el.getBoundingClientRect()
      const z = view.session.camera
      const at = (x, y) => [b.left + (x - z.x) * z.zoom, b.top + (y - z.y) * z.zoom]
      await draw(...at(40, 100), ...at(260, 100), 'pen', 0.9, 0.9)
      const made = await view.saveNew(pic, false)
      const pixels = async (file) => {
        const img = new Image(); img.src = app.vault.getResourcePath(file); await img.decode()
        const k = document.createElement('canvas'); k.width = img.naturalWidth; k.height = img.naturalHeight
        const x = k.getContext('2d'); x.drawImage(img, 0, 0)
        const mid = x.getImageData(150, 100, 1, 1).data
        return { w: img.naturalWidth, h: img.naturalHeight, changed: mid[0] < 100 }
      }
      const fresh = await pixels(made)
      await view.saveOver(pic, true)
      const over = (await pixels(app.vault.getAbstractFileByPath(PIC))).changed
      await app.vault.delete(made)
      let chat = 'no chat'
      if (window.__abeleTest.AbeleConfig.getInstance().ai.enabled) {
        await view.sendToChat(pic)
        const input = await until(() => [...document.querySelectorAll('.abele-chat-input__attachment')].map((e) => e.textContent.trim()).filter((t) => t.includes('picture drawn')).join() || null, 8000)
        chat = input ? [input] : []
        const sent = app.vault.getAbstractFileByPath(DIR + '/picture drawn.png'); if (sent) await app.vault.delete(sent)
      }
      app.workspace.getLeavesOfType('abele-image-ink').forEach((l) => l.detach())
      return { fresh, over, chat }
    `)
    expect(r.error).toBeUndefined()
    expect(r.fresh).toEqual({ w: 300, h: 200, changed: true })
    expect(r.over).toBe(true)
    if (r.chat !== 'no chat') expect((r.chat as string[]).length).toBeGreaterThan(0)
  })

  it('keeps stylus micro-smoothing bounded with raw and drawn strokes side by side', async () => {
    for (const mobile of [false, true]) {
      await setWindowSize(mobile ? 390 : 1000, mobile ? 844 : 800)
      await reload(`app.emulateMobile(${mobile})`)
      for (const zoom of [1, 4]) {
        const r = run<{ error?: string; deviations: number[]; endpoints: boolean[] }>(`
          await closeAll()
          const view = await newOne()
          view.session.setCamera({ x: 0, y: 0, zoom: ${zoom} })
          const el = view.session.surface.el, b = box(view), z = ${zoom}
          const shapes = [
            Array.from({ length: 70 }, (_, i) => [i, 5 * Math.sin(i / 7) + 0.15 * (i % 2)]),
            [[0, 20], [0, 0], [20, 20], [20, 0], [40, 20], [60, 0]],
            [[0.123, 0.456]],
          ]
          const deviations = [], endpoints = []
          for (let k = 0; k < shapes.length; k++) {
            const xy = shapes[k], oy = 100 + k * 65
            const raw = xy.flatMap(([x, y]) => [(30 + x) / z, (oy + y) / z, 0.5])
            // The picture editor maps screen coordinates through its orientation adapter.
            // Keep strict endpoint equality against that boundary, including floating-point
            // transforms, rather than assuming the removed editor's direct screen mapping.
            const expected = xy.flatMap(([x, y]) => [
              ...view.session.surface.worldAt({clientX:b.left+150+x,clientY:b.top+oy+y}),0.5
            ])
            // Left: unsmoothed input. Right: the same samples through the real surface.
            const send = (type, pt) => el.dispatchEvent(new PointerEvent(type, {
              pointerId: 81, pointerType: 'pen', bubbles: true, buttons: type === 'pointerup' ? 0 : 1,
              pressure: type === 'pointerup' ? 0 : 0.5,
              clientX: b.left + 150 + pt[0], clientY: b.top + oy + pt[1],
            }))
            send('pointerdown', xy[0])
            for (const pt of xy.slice(1, -1)) send('pointermove', pt)
            // The final position arrives only on pointerup.
            send('pointerup', xy[xy.length - 1])
            const stroke = items(view).at(-1)
            if (!stroke.linear) throw new Error('Stylus input was not bounded')
            view.session.items.add([{ ...stroke, freedraw: undefined, id: 'raw-' + k, points: raw }])
            // Lift-off retains the last contact pressure, including a newly delivered endpoint.
            if (stroke.points.length !== expected.length) throw new Error('Lost samples')
            deviations.push(Math.max(...xy.map((_, i) => Math.hypot(stroke.points[i * 3] - expected[i * 3], stroke.points[i * 3 + 1] - expected[i * 3 + 1]) * z)))
            endpoints.push(JSON.stringify(stroke.points.slice(-3)) === JSON.stringify(expected.slice(-3)))
          }
          view.session.setCamera({ x: 0, y: 0, zoom: z })
          await wait(200)
          await shoot('smoothing-${mobile ? 'phone' : 'desktop'}-${zoom}x-raw-left')
          return { deviations, endpoints }
        `)
        expect(r.error).toBeUndefined()
        expect(r.endpoints).toEqual([true, true, true])
        expect(r.deviations).toHaveLength(3)
        expect(Math.max(...r.deviations)).toBeLessThanOrEqual(0.5)
      }
    }
  }, 240_000)
})
