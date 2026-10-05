/**
 * A drawing shown in a note, in the running app: embedded the plain way (`![[Sketch.svg]]`), the
 * way a new one is inserted and the part kept in its link, as well as through the callout older
 * notes use, in reading view and live preview, it draws what is on the drawing —
 * counted in the pixels of the screen, not in the markup — at the drawing's own size, and follows
 * a stroke drawn after it. Two embeds of one drawing in a note are sized apart: a size named in the
 * link, a handle dragged and written back into the embed dragged, a part kept into the callout it
 * was changed in. The buttons on every embed show at a mouse over it, or after a tap that does
 * nothing else on a touch screen, and one of them opens the drawing.
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
import { shotDir } from './helpers/shots'
import { WAIT_PRELUDE } from './helpers/wait'
import { requireSameEmbedGeometry, type EmbedProof } from '../helpers/ref4ReleaseProof'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { drawingSvg, parseDrawingSvg } from '../../src/drawing/drawingFile'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele drawing embed e2e'
const SHOTS = shotDir('abele-phone')

const attachDebugger = (): void => void runCli(['dev:debug', 'on'], 30_000)

const PRELUDE = `
  const DIR = ${JSON.stringify(DIR)}
  ${WAIT_PRELUDE}
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
  const views = () => app.workspace.getLeavesOfType('abele-drawing').map((l) => l.view).filter(v => v.file?.path.startsWith(DIR + '/'))
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
  const measuredInk = async (el, leaf, paper) => {
    const rect = r => ({ x:r.x, y:r.y, width:r.width, height:r.height })
    const r=el.getBoundingClientRect()
    const crop={x:Math.round(r.left)+1,y:Math.round(r.top)+1,width:Math.round(r.width)-2,height:Math.round(r.height)-2}
    const image=await wc.capturePage(crop), bitmap=image.toBitmap()
    let count=0;for(let i=0;i<bitmap.length;i+=4)if(bitmap[i]+bitmap[i+1]+bitmap[i+2]<300)count++
    return { ink:count, geometry:{paneId:leaf.id,rect:rect(r),imageRect:rect(el.querySelector('img').getBoundingClientRect()),crop,paper,dpr:devicePixelRatio,bitmapBytes:bitmap.length} }
  }
  const note = async (name, text, mode, pane = 'tab') => {
    const path = DIR + '/' + name + '.md'
    const old = app.vault.getAbstractFileByPath(path)
    if (old) await app.vault.modify(old, text); else await app.vault.create(path, text)
    const leaf = app.workspace.getLeaf(pane)
    await leaf.setViewState({ type: 'markdown', state: { file: path, mode, source: false }, active: true })
    if (!await until(() => leaf.view.file?.path === path && leaf.view.getMode() === mode))
      throw new Error('note did not open in the requested mode')
    return leaf
  }
  const boxes = (leaf) => [...leaf.view.containerEl.querySelectorAll(leaf.view.getMode() === 'preview' ? '.markdown-reading-view .abele-drawing-embed' : '.markdown-source-view .abele-drawing-embed')]
  const closeAll = async () => {
    for (const type of ['abele-drawing', 'markdown']) for (const leaf of app.workspace.getLeavesOfType(type))
      if (leaf.view.file?.path.startsWith(DIR + '/')) leaf.detach()
    if (!await until(() => ['abele-drawing', 'markdown'].every(type => !app.workspace.getLeavesOfType(type).some(leaf => leaf.view.file?.path.startsWith(DIR + '/')))))
      throw new Error('drawing and note tabs did not close')
  }
  const pictureReady = async (box) => {
    if (!await until(() => {
      const img = box?.querySelector('img')
      return box?.isConnected && box.clientWidth > 0 && box.clientHeight > 0 && img?.complete && img.naturalWidth > 0
    })) throw new Error('embedded drawing image did not load')
    await box.querySelector('img').decode()
  }
  const drawingReady = async (view) => {
    if (!await until(() => view?.session?.surface.width > 0 && view.session.surface.height > 0 &&
      view.contentEl.querySelector('.abele-drawing-bar__mode')?.getBoundingClientRect().width > 0))
      throw new Error('drawing surface did not become ready')
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
      await drawingReady(view)
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
        for (const type of ['abele-drawing', 'markdown']) for (const leaf of app.workspace.getLeavesOfType(type))
          if (leaf.view.file?.path.startsWith(${JSON.stringify(DIR + '/')})) leaf.detach()
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
      await drawingReady(view)
      const file = view.file
      const b = view.session.surface.el.getBoundingClientRect()
      await stroke([[b.left + 100, b.top + 100], [b.left + 300, b.top + 160], [b.left + 120, b.top + 220]])
      view.contentEl.querySelector('.abele-drawing-bar__mode').click()
      await until(async () => (await read(file.path)).includes('<path d="M'), 5000)
      // Closed at once: the save still waiting must not write an empty drawing after it.
      view.leaf.detach()
      // Observation window: a pending save must not empty the drawing after closing it.
      await wait(3000)
      const kept = (await read(file.path)).includes('<path d="M')
      const leaf = await note('Closed', '![[' + file.name + ']]\\n', 'preview')
      const box = await until(() => boxes(leaf).find((x) => x.querySelector('img')?.complete && x.clientWidth), 8000)
      await pictureReady(box)
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
      geometryBefore?: EmbedProof
      geometryAfter?: EmbedProof
      repeat?: { ink: number; geometry: EmbedProof }
      savedBefore?: string
      savedAfter?: string
      reading?: { ink: number; w: number }
    }>(`
      await closeAll()
      // This diagonal establishes the entire paper; the later zigzag stays inside it.
      const file = await app.vault.create(DIR + '/sample-paired.svg', ${JSON.stringify(drawingSvg({ items: [{ id: 'sample-first', type: 'stroke', tool: 'pen', color: 'black', size: 2.4, points: [80, 110, 0.5, 390, 400, 0.5] }] }))})
      const path = file.path
      const savedBefore = await read(path)
      const paper = Number(/viewBox="[-\\d.]+ [-\\d.]+ ([\\d.]+)/.exec(savedBefore)[1])
      const drawingLeaf = app.workspace.getLeaf('tab')
      await drawingLeaf.openFile(file)
      const view = await until(() => views().find((v) => v.file?.path === path && v.session?.surface.width), 8000)
      await drawingReady(view)
      // Put the note beside the drawing BEFORE either ink-area measurement.
      const noteLeaf = await note('Plain', '# Plain\\n\\n![[' + file.name + ']]\\n\\nAfter.\\n', 'source', 'split')
      const box = await until(() => boxes(noteLeaf).find((b) => b.querySelector('img')?.complete && b.clientWidth), 8000)
      await pictureReady(box)
      let signature=''
      if (!await until(() => { const now=JSON.stringify(box.getBoundingClientRect().toJSON());const same=now===signature;signature=now;return same })) throw Error('paired geometry not ready')
      // Obsidian's own picture of the file is not what shows.
      const native = [...noteLeaf.view.containerEl.querySelectorAll('.internal-embed img')].filter((i) => !i.closest('.abele-drawing-embed') && i.getBoundingClientRect().height > 0).length
      const measuredBefore = await measuredInk(box, noteLeaf, /viewBox="([^"]+)"/.exec(savedBefore)[1])
      const repeat = await measuredInk(box, noteLeaf, /viewBox="([^"]+)"/.exec(await read(path))[1])
      const live = box && { ink: measuredBefore.ink, w: box.clientWidth, h: box.clientHeight, room: noteLeaf.view.containerEl.querySelector('.cm-content').clientWidth, paper, native }
      await shoot('plain-live')
      // A stroke drawn with the note open beside the drawing shows in the note.
      const src = box.querySelector('img').src
      app.workspace.setActiveLeaf(drawingLeaf, { focus:false })
      view.contentEl.querySelector('.abele-drawing-bar__mode').click()
      if (!await until(() => view.model.on)) throw new Error('drawing mode did not turn on')
      const b = view.session.surface.el.getBoundingClientRect(), camera=view.session.camera
      const points=[[90,280],[340,310],[100,350],[340,390]]
      await stroke(points.map(([x,y]) => [b.left+(x-camera.x)*camera.zoom,b.top+(y-camera.y)*camera.zoom]))
      const savedAfter = await until(async () => { const text=await read(path);const data=JSON.parse(/<metadata id="abele-drawing">([\\s\\S]*?)<\\/metadata>/.exec(text)[1]);return data.items.length===2&&text }, 8000)
      if (!savedAfter) throw Error('new stroke not saved')
      const moved = await until(() => { const now = boxes(noteLeaf)[0]; return now && now.querySelector('img').src !== src && now }, 8000)
      await pictureReady(moved)
      const measuredAfter = await measuredInk(moved, noteLeaf, /viewBox="([^"]+)"/.exec(savedAfter)[1])
      const after = { ink: measuredAfter.ink, src: !!moved }
      await shoot('plain-live-after')
      view.leaf.detach()
      await noteLeaf.setViewState({ type: 'markdown', state: { file: noteLeaf.view.file.path, mode: 'preview' } })
      const rb = await until(() => boxes(noteLeaf).find((b) => b.querySelector('img')?.complete && b.clientWidth), 8000)
      await pictureReady(rb)
      const reading = rb && { ink: await ink(rb), w: rb.clientWidth }
      await shoot('plain-reading')
      return { live, after, reading, savedBefore, savedAfter, repeat, geometryBefore:measuredBefore.geometry, geometryAfter:measuredAfter.geometry }
    `)
    writeFileSync(join(SHOTS, 'drawing-geometry-proof.json'), JSON.stringify(r, null, 2))
    expect(r.error).toBeUndefined()
    requireSameEmbedGeometry(r.geometryBefore!, r.geometryAfter!)
    requireSameEmbedGeometry(r.geometryBefore!, r.repeat!.geometry)
    // An unchanged rendered image must not satisfy the positive-change predicate.
    expect(r.repeat!.ink > r.live!.ink * 1.3).toBe(false)
    const before = parseDrawingSvg(r.savedBefore!)!
    const after = parseDrawingSvg(r.savedAfter!)!
    expect(before.items).toHaveLength(1)
    expect(after.items).toHaveLength(2)
    expect(after.items[0]).toEqual(before.items[0])
    expect(after.items[1].type).toBe('stroke')
    expect(after.items[1].id).not.toBe(before.items[0].id)
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
      await Promise.all(both.map(pictureReady))
      const named = both[0].clientWidth
      const other = both[1].clientWidth
      const h = both[1].querySelector('.abele-drawing-embed__resize').getBoundingClientRect()
      const x = h.left + h.width / 2, y = h.top + h.height / 2
      await input('mousePressed', x, y, 'mouse', 1)
      for (let i = 1; i <= 8; i++) { await input('mouseMoved', x - i * 10, y, 'mouse', 1); await wait(16) }
      await input('mouseReleased', x - 80, y, 'mouse', 0)
      const text = await until(async () => { const t = await read(leaf.view.file.path); return /\\|\\d+\\]\\]\\n$/.test(t) && t }, 5000)
      await until(() => boxes(leaf)[1]?.clientWidth < other)
      const now = boxes(leaf)
      const dragged = now[1]?.clientWidth
      await shoot('twice')
      // Two callouts naming the same part: the part kept goes into the one it was changed in.
      const callout = '> [!drawing]\\n> ![[' + file.name + ']]\\n'
      const cl = await note('Twice callouts', 'Callouts\\n\\n' + callout + '\\n' + callout, 'source')
      const cb = await until(() => { const b = boxes(cl); return b.length === 2 && b.every((x) => x.clientWidth) && b }, 8000)
      await Promise.all(cb.map(pictureReady))
      cb[1].querySelector('.abele-drawing-embed__adjust').click()
      await until(() => cb[1].classList.contains('abele-drawing-embed_adjusting'))
      const imageWidth = cb[1].querySelector('img').getBoundingClientRect().width
      const br = cb[1].getBoundingClientRect()
      await cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(br.left + br.width / 2), y: Math.round(br.top + br.height / 2), deltaX: 0, deltaY: -50, modifiers: 2 })
      await until(() => cb[1].querySelector('img').getBoundingClientRect().width > imageWidth)
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

  it('goes into a note as its embed alone, and keeps a part changed there in the link', () => {
    const r = run<{
      error?: string
      inserted?: string
      shown?: boolean
      text?: string
      partPicture?: number
      wholePicture?: number
    }>(`
      await closeAll()
      const file = app.vault.getAbstractFileByPath(window.__embedDrawing)
      // The command at the cursor: the embed and nothing round it.
      const ins = await note('Inserted', 'Before\\n', 'source')
      ins.view.editor.setCursor({ line: 1, ch: 0 })
      app.commands.executeCommandById('abele:insert-drawing')
      const inserted = await until(() => { const t = ins.view.editor.getValue(); return t.includes('![[') && t }, 8000)
      await until(() => views().length, 8000)
      for (const v of views()) v.leaf.detach()
      await until(() => !views().length)
      const made = /!\\[\\[([^\\]]+)\\]\\]/.exec(inserted || '')?.[1]
      const madeFile = made && app.metadataCache.getFirstLinkpathDest(made, ins.view.file.path)
      // Shown by the plugin, in live preview, with no callout.
      const shown = !!(await until(() => boxes(ins).find((b) => b.clientWidth && !b.closest('.callout')), 8000))
      if (madeFile) await app.vault.delete(madeFile)
      // A part changed on an embed alone goes into that embed's link.
      const leaf = await note('Part in link', 'Part\\n\\n![[' + file.name + ']]\\n\\n![[' + file.name + ']]\\n', 'source')
      const two = await until(() => { const b = boxes(leaf); return b.length === 2 && b.every((x) => x.clientWidth && x.querySelector('img')?.complete) && b }, 8000)
      await Promise.all(two.map(pictureReady))
      two[1].querySelector('.abele-drawing-embed__adjust').click()
      await until(() => two[1].classList.contains('abele-drawing-embed_adjusting'))
      const br = two[1].getBoundingClientRect()
      for (let i = 0; i < 4; i++) { await cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(br.left + br.width / 2), y: Math.round(br.top + br.height / 2), deltaX: 0, deltaY: -50, modifiers: 2 }); await wait(60) }
      two[1].querySelector('.abele-drawing-embed__keep').click()
      const text = await until(async () => { const t = await read(leaf.view.file.path); return t.includes('#part=') && t }, 5000)
      await until(() => !boxes(leaf)[1]?.classList.contains('abele-drawing-embed_adjusting'))
      // In reading view the part is what shows: the drawing's picture overflows its box, cut to the part.
      await leaf.setViewState({ type: 'markdown', state: { file: leaf.view.file.path, mode: 'preview' } })
      const rb = await until(() => { const b = boxes(leaf); return b.length === 2 && b.every((x) => x.clientWidth && x.querySelector('img')?.complete) && b }, 8000)
      await Promise.all(rb.map(pictureReady))
      await shoot('part-in-link')
      const img = (b) => b.querySelector('img').getBoundingClientRect().width / b.clientWidth
      return { inserted, shown, text, partPicture: rb && img(rb[1]), wholePicture: rb && img(rb[0]) }
    `)
    expect(r.error).toBeUndefined()
    expect(r.inserted).toMatch(/^Before\n!\[\[[^\]]+\.svg\]\]\n$/)
    expect(r.shown).toBe(true)
    const lines = r.text!.split('\n')
    expect(r.text).not.toContain('[!drawing')
    expect(lines[2]).not.toContain('#part=')
    expect(lines[4]).toMatch(/^!\[\[[^\]#]+\.svg#part=-?\d+,-?\d+,\d+,\d+\]\]$/)
    // The whole drawing fits its box; the part's box shows only a piece of the picture.
    expect(r.partPicture!).toBeGreaterThan(r.wholePicture! * 1.3)
  })

  it('shows its buttons to a mouse over it or after a first tap that does nothing else, and opens the drawing from one', async () => {
    const desk = run<{
      error?: string
      away?: string
      over?: string
      opened?: string
      zoom?: number
      plain?: string
    }>(`
      await closeAll()
      const file = app.vault.getAbstractFileByPath(window.__embedDrawing)
      const leaf = await note('Open', '> [!drawing|100 100 120 60]\\n> ![[' + file.name + ']]\\n\\n![[' + file.name + ']]\\n', 'preview')
      const b = await until(() => { const b = boxes(leaf); return b.length === 2 && b.every((x) => x.clientWidth) && b }, 8000)
      const actions = b[0].querySelector('.abele-drawing-embed__actions')
      const br = b[0].getBoundingClientRect()
      // The mouse away from the drawing: nothing over it.
      await cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(br.right + 200), y: Math.round(br.bottom + 200) })
      await until(() => getComputedStyle(actions).opacity === '0')
      const away = getComputedStyle(actions).opacity
      await cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(br.left + br.width / 2), y: Math.round(br.top + br.height / 2) })
      await until(() => getComputedStyle(actions).opacity === '1')
      const over = getComputedStyle(actions).opacity
      await shoot('hover')
      // Pressed with the mouse where it shows.
      const g = b[0].querySelector('.abele-drawing-embed__go').getBoundingClientRect()
      await cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(g.left + g.width / 2), y: Math.round(g.top + g.height / 2) })
      await input('mousePressed', g.left + g.width / 2, g.top + g.height / 2, 'mouse', 1)
      await input('mouseReleased', g.left + g.width / 2, g.top + g.height / 2, 'mouse', 0)
      const view = await until(() => views().find((v) => v.file?.path === file.path && v.session?.surface.width), 8000)
      await drawingReady(view)
      await until(() => view.session.camera.zoom > 1.5)
      const zoom = view?.session.camera.zoom
      view?.leaf.detach()
      b[1].querySelector('.abele-drawing-embed__go').click()
      const plain = (await until(() => views().find((v) => v.file?.path === file.path), 8000))?.file.path
      return { away, over, opened: view?.file.path, zoom, plain }
    `)
    expect(desk.error).toBeUndefined()
    expect(desk.away).toBe('0')
    expect(desk.over).toBe('1')
    expect(desk.opened).toMatch(/\.svg$/)
    // The part is 120 wide: it opens zoomed in on it.
    expect(desk.zoom).toBeGreaterThan(1.5)
    expect(desk.plain).toBe(desk.opened)

    await reloadApp('app.emulateMobile(true)')
    attachDebugger()
    const phone = run<{
      error?: string
      before?: string
      shown?: boolean
      cursor?: boolean
      openedByTap?: boolean
      opened?: boolean
      gone?: boolean
      goneElsewhere?: boolean
    }>(`
      await until(() => app.workspace.layoutReady, 15000)
      await closeAll()
      const file = app.vault.getAbstractFileByPath(window.__embedDrawing ?? app.vault.getFiles().find((f) => f.path.startsWith(DIR) && f.extension === 'svg').path)
      const leaf = await note('Open phone', 'Top line\\n\\n![[' + file.name + ']]\\n', 'source')
      const box = await until(() => boxes(leaf).find((x) => x.clientWidth), 8000)
      await pictureReady(box)
      const editor = leaf.view.editor
      editor.setCursor({ line: 0, ch: 0 })
      document.activeElement?.blur?.()
      const focused = () => !!leaf.view.containerEl.querySelector('.cm-content')?.contains(document.activeElement)
      const wasFocused = focused()
      await cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 })
      const actions = box.querySelector('.abele-drawing-embed__actions')
      await until(() => getComputedStyle(actions).opacity === '0')
      const before = getComputedStyle(actions).opacity
      // Keep the post-tap observation window: the first tap must neither open nor focus.
      const tapAt = async (x, y) => { await touch('touchStart', [[x, y]]); await wait(30); await touch('touchEnd', []); await wait(300) }
      // The first tap, right where the button would be: it shows the buttons and nothing else.
      const g = box.querySelector('.abele-drawing-embed__go').getBoundingClientRect()
      await tapAt(g.left + g.width / 2, g.top + g.height / 2)
      const shown = box.classList.contains('abele-drawing-embed_shown') && getComputedStyle(actions).opacity === '1'
      const openedByTap = views().some((v) => v.file?.path === file.path)
      // The cursor stays where it was, and the editor is not focused by it (a phone's keyboard).
      const cursor = editor.getCursor().line === 0 && !wasFocused && !focused()
      await shoot('phone-tap')
      // The second tap presses it.
      await tapAt(g.left + g.width / 2, g.top + g.height / 2)
      const opened = !!(await until(() => views().find((v) => v.file?.path === file.path), 8000))
      for (const v of views()) v.leaf.detach()
      await until(() => !views().length)
      const again = await until(() => boxes(leaf).find((x) => x.clientWidth), 8000)
      // Left alone, they go after a few seconds; a tap elsewhere puts them away at once.
      const b2 = again.getBoundingClientRect()
      await tapAt(b2.left + b2.width / 2, b2.top + b2.height / 2)
      const shownAgain = again.classList.contains('abele-drawing-embed_shown')
      await until(() => !again.classList.contains('abele-drawing-embed_shown'))
      const gone = shownAgain && !again.classList.contains('abele-drawing-embed_shown')
      await tapAt(b2.left + b2.width / 2, b2.top + b2.height / 2)
      const t = leaf.view.containerEl.querySelector('.cm-line').getBoundingClientRect()
      await tapAt(t.left + 10, t.top + t.height / 2)
      const goneElsewhere = !again.classList.contains('abele-drawing-embed_shown')
      return { before, shown, cursor, openedByTap, opened, gone, goneElsewhere }
    `)
    expect(phone.error).toBeUndefined()
    expect(phone.before).toBe('0')
    expect(phone.shown).toBe(true)
    expect(phone.openedByTap).toBe(false)
    expect(phone.cursor).toBe(true)
    expect(phone.opened).toBe(true)
    expect(phone.gone).toBe(true)
    expect(phone.goneElsewhere).toBe(true)
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
      await pictureReady(box)
      const tap = async (el) => {
        const r = el.getBoundingClientRect()
        await touch('touchStart', [[r.left + r.width / 2, r.top + r.height / 2]])
        await wait(30)
        await touch('touchEnd', [])
        await wait(200)
      }
      // The first tap shows the buttons, the second presses one.
      await tap(box.querySelector('.abele-drawing-embed__adjust'))
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
      const now = await until(() => boxes(leaf).find((x) => x.clientWidth && !x.matches('.abele-drawing-embed_adjusting')), 8000)
      await pictureReady(now)
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
