import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { evalJson, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const DIR = 'Sample walkthrough'
const SHOTS = shotDir('canvas-viewer')
const mobile = process.env.CANVAS_VIEWER_MOBILE === '1'
const PRELUDE = `
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const path = ${JSON.stringify(`${DIR}/sample.canvas`)}
  const scope = new window.__abeleTest.ScopeResolver(); scope.setFullVaultAccess(true)
  const ctx = { scope, interactive: true }
  const tools = Object.fromEntries(window.__abeleTest.createAgentTools().map(t => [t.name, t]))
  const read = async () => JSON.parse((await tools.canvas_read.execute('sample-read', { path }, undefined, ctx)).content[0].text)
  const view = () => app.workspace.getLeavesOfType('abele-canvas').find(l => l.view.file?.path === path)?.view
  const capture = async name => {
    if (window.__e2eHost) return
    const img = await require('@electron/remote').getCurrentWebContents().capturePage()
    require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/' + name + '.png', img.toPNG())
  }
`
const run = <T>(body: string): T => evalAsync<T>(`(async () => { ${PRELUDE} ${body} })()`, 120_000)
const shoot = (name: string) => {
  if (onPhone()) return
  run(
    `const img = await require('@electron/remote').getCurrentWebContents().capturePage(); require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/' + ${JSON.stringify(name)} + '.png', img.toPNG()); return true`
  )
}

describe.skipIf(!available)('read-only walkthrough viewer and canvas note embeds', () => {
  let size: number[] | null = null
  beforeAll(async () => {
    if (mobile && !onPhone()) {
      size = evalJson<number[]>(`require('@electron/remote').getCurrentWindow().getContentSize()`)
      evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390, 844)`)
      await reloadApp('app.emulateMobile(true)')
    }
    run(`
      if (app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})) throw new Error('Synthetic folder already exists')
      window.__canvasViewerLayout = app.workspace.getLayout()
      window.__canvasViewerPreference = window.__abeleTest.AbeleConfig.getInstance().canvasViewer
      window.__abeleTest.AbeleConfig.getInstance().canvasViewer = true
      await app.vault.createFolder(${JSON.stringify(DIR)}); window.__canvasViewerOwned = true
      await app.vault.create(${JSON.stringify(`${DIR}/sample-note.md`)}, ${JSON.stringify('# Sample detail\nLive note content.\n\nA linked explanation.')})
      await tools.canvas_create.execute('sample', { path, from: { graph: { nodes: [
        { id: 'alpha', kind: 'text', label: 'Input concept' },
        { id: 'beta', kind: 'shape', shape: 'pill', label: 'Transform the input' },
        { id: 'note', kind: 'note', file: ${JSON.stringify(`${DIR}/sample-note.md`)}, width: 280, height: 220 },
      ], edges: [{ id: 'flow', fromNode: 'alpha', toNode: 'beta', label: 'transform' }, { id: 'detail', fromNode: 'beta', toNode: 'note', label: 'explain' }] } } }, undefined, ctx)
      await tools.canvas_steps.execute('sample', { path, revision: (await read()).revision, ops: [{ op: 'replace', steps: [
        { id: 'input', reveal: ['alpha'], focus: 'alpha', say: 'Start with one input concept.' },
        { id: 'transform', reveal: ['beta'], focus: 'beta', highlight: ['beta', 'flow'], say: 'The transform changes the input.' },
        { id: 'detail', reveal: ['note'], focus: 'note', say: 'Open the linked note for the details.' },
      ] }] }, undefined, ctx)
      await app.vault.create(${JSON.stringify(`${DIR}/sample-embed.md`)}, ${JSON.stringify('# Sample explanation\n\n![[sample.canvas#step=2]]\n\n![[sample.canvas#node=alpha]]\n\nTail paragraph.\n')})
      return true
    `)
  }, 120_000)
  afterAll(async () => {
    run(`
      const leaves = []; app.workspace.iterateAllLeaves(l => { if (l.view.file?.path.startsWith(${JSON.stringify(DIR + '/')})) leaves.push(l) }); leaves.forEach(l => l.detach())
      for (const path of window.__canvasViewerExports ?? []) { const file = app.vault.getAbstractFileByPath(path); if (file) await app.vault.delete(file, true) }
      if (window.__canvasViewerOwned) { const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)}); if (dir) await app.vault.delete(dir, true) }
      if (window.__canvasViewerPreference !== undefined) window.__abeleTest.AbeleConfig.getInstance().canvasViewer = window.__canvasViewerPreference
      if (window.__canvasViewerLayout) await app.workspace.changeLayout(window.__canvasViewerLayout)
      delete window.__canvasViewerOwned; delete window.__canvasViewerLayout; delete window.__canvasViewerExports; delete window.__canvasViewerPreference
      return true
    `)
    if (size) {
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]})`
      )
      await reloadApp('app.emulateMobile(false)')
    }
  }, 120_000)
  it('adopts canvases by default, preserves bytes, and plays keyboard/tap navigation', () => {
    const result = run<{
      type: string
      first: string[]
      next: number
      say: string
      width: number
      overflow: number
      same: boolean
      safeNarration: boolean
    }>(`
      const file = app.vault.getAbstractFileByPath(path), before = await app.vault.read(file)
      const leaf = app.workspace.getLeaf('tab'); await leaf.openFile(file); await app.workspace.revealLeaf(leaf); await wait(600)
      const v = view(); v.viewer.go(1, false); await wait(200)
      const first = v.viewer.scene().graph.nodes.map(n => n.id)
      v.contentEl.focus()
      if (window.__e2eHost) v.contentEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      else {
        const cdp = require('@electron/remote').getCurrentWebContents().debugger, owned = !cdp.isAttached()
        if (owned) cdp.attach('1.3')
        try {
          await cdp.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
          await cdp.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
        } finally { if (owned) cdp.detach() }
      }
      await wait(400)
      const next = v.viewer.step, say = v.viewer.narration.textContent
      v.contentEl.querySelector('[aria-label="Previous step"]').click(); await wait(300)
      const nav = document.querySelector('.mobile-navbar'), rect = nav?.getBoundingClientRect()
      const safeNarration = !rect || rect.height === 0 || v.viewer.narration.getBoundingClientRect().bottom <= rect.top
      return { type: leaf.view.getViewType(), first, next, say, width: v.viewer.stage.clientWidth, overflow: v.contentEl.scrollWidth - v.contentEl.clientWidth, same: before === await app.vault.read(file), safeNarration }
    `)
    expect(result.type).toBe('abele-canvas')
    expect(result.first).toEqual(['alpha'])
    expect(result.next).toBe(2)
    expect(result.say).toBe('The transform changes the input.')
    expect(result.width).toBeGreaterThan(100)
    expect(result.overflow).toBeLessThanOrEqual(1)
    expect(result.same).toBe(true)
    expect(result.safeNarration).toBe(true)
    shoot('step-one')
  }, 120_000)
  it('zooms/pans, renders only revealed live cards, and follows a linked note change', () => {
    const result = run<{
      zoom: boolean
      pan: boolean
      hidden: boolean
      live: boolean
      changed: boolean
    }>(`
      const v = view(), viewer = v.viewer; viewer.go(1, false); await wait(200)
      const hidden = !v.contentEl.querySelector('[data-node-id="note"]')
      const zoom = viewer.camera.zoom
      viewer.stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -30, ctrlKey: true, clientX: 100, clientY: 100, bubbles: true, cancelable: true })); await wait(100)
      const zoomed = viewer.camera.zoom !== zoom, x = viewer.camera.x
      viewer.stage.dispatchEvent(new WheelEvent('wheel', { deltaX: 40, bubbles: true, cancelable: true })); await wait(100)
      const panned = viewer.camera.x !== x
      viewer.go(3, false); await wait(400)
      const live = v.contentEl.querySelector('[data-node-id="note"]')?.textContent.includes('Live note content.') ?? false
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(`${DIR}/sample-note.md`)})
      await app.vault.modify(file, ${JSON.stringify('# Sample detail\nChanged live note content.')}); await wait(500)
      return { zoom: zoomed, pan: panned, hidden, live, changed: v.contentEl.querySelector('[data-node-id="note"]')?.textContent.includes('Changed live note content.') ?? false }
    `)
    expect(result).toEqual({ zoom: true, pan: true, hidden: true, live: true, changed: true })
    shoot('live-note')
  }, 120_000)
  it('keeps an agent-edited selected step stable by id and gives the agent the same revealed crop', () => {
    const result = run<{
      number: number
      say: string
      visible: string[]
      pictureSay: string
      same: boolean
      missingWarnings: number
    }>(`
      const v = view(); v.viewer.go(2, false)
      const file = app.vault.getAbstractFileByPath(path)
      await tools.canvas_steps.execute('sample', { path, revision: (await read()).revision, ops: [{ op: 'move', id: 'transform', before: 'input' }, { op: 'upsert', step: { id: 'transform', reveal: ['alpha','beta'], highlight: ['beta'], focus: 'beta', say: 'Refined transform explanation.' } }] }, undefined, ctx)
      await wait(500)
      const result = await tools.look_at_canvas.execute('sample', { path, step: 1, maxSide: 800 }, undefined, ctx), data = JSON.parse(result.content[0].text)
      const before = await app.vault.read(file); v.viewer.go(null, false); v.viewer.go(1, false); await wait(200)
      return { number: v.viewer.step, say: v.viewer.narration.textContent, visible: data.visible, pictureSay: data.say, same: before === await app.vault.read(file), missingWarnings: data.warnings.filter(w => w.code === 'missing-step-id').length }
    `)
    expect(result.number).toBe(1)
    expect(result.say).toBe('Refined transform explanation.')
    expect(result.visible).not.toContain('note')
    expect(result.pictureSay).toBe(result.say)
    expect(result.missingWarnings).toBe(0)
    expect(result.same).toBe(true)
  }, 120_000)
  it('replaces reading and Live Preview embeds, including late native children, and opens the named step', () => {
    const result = run<{
      reading: number
      live: number
      nativeHidden: boolean
      opened: number
      says: boolean
    }>(`
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(`${DIR}/sample-embed.md`)})
      const leaf = app.workspace.getLeaf('tab'); await leaf.openFile(file); await app.workspace.revealLeaf(leaf)
      await leaf.view.setState({ mode: 'preview' }, {}); await wait(800)
      const reading = leaf.view.previewMode.containerEl.querySelectorAll('.abele-canvas-embed img[src^="data:image/png"]').length
      await capture('reading-embeds')
      await leaf.view.setState({ mode: 'source', source: false }, {}); leaf.view.editor.setCursor({ line: 7, ch: 0 }); await wait(1000)
      const embeds = [...leaf.view.editor.cm.contentDOM.querySelectorAll('.internal-embed.abele-canvas-embed-source')]
      const live = embeds.filter(e => e.querySelector('.abele-canvas-embed img[src^="data:image/png"]')).length
      for (const embed of embeds) { const late = document.createElement('div'); late.textContent = 'Late native sample'; embed.append(late) }
      await wait(150)
      const nativeHidden = embeds.every(e => [...e.children].filter(c => !c.classList.contains('abele-canvas-embed')).every(c => c.getBoundingClientRect().height === 0))
      const says = embeds.some(e => e.textContent.includes('Start with one input concept.'))
      await capture('live-preview-embeds')
      embeds[0].querySelector('[aria-label="Play diagram"]').click(); await wait(500)
      return { reading, live, nativeHidden, opened: view().viewer.step, says }
    `)
    expect(result).toEqual({ reading: 2, live: 2, nativeHidden: true, opened: 2, says: true })
    shoot('embed-play')
  }, 120_000)
  it('plays the walkthrough from a node embed without cancelling it with the node crop', () => {
    const result = run<{ playing: number; say: string; opened: number | null; focused: boolean }>(`
      const file=app.vault.getAbstractFileByPath(${JSON.stringify('Sample walkthrough/sample-embed.md')})
      const leaf=app.workspace.getLeaf('tab'); await leaf.openFile(file); await app.workspace.revealLeaf(leaf)
      await leaf.view.setState({mode:'source',source:false},{}); leaf.view.editor.setCursor({line:7,ch:0}); await wait(900)
      const embed=leaf.view.editor.cm.contentDOM.querySelector('.internal-embed[src*="#node=alpha"]')
      embed.querySelector('[aria-label="Play diagram"]').click(); await wait(400)
      const playing=view().viewer.step, say=view().viewer.narration.textContent
      await app.workspace.revealLeaf(leaf); await wait(200)
      embed.querySelector('[aria-label="Open diagram"]').click(); await wait(300)
      const viewer=view().viewer, alpha=viewer.graph.nodes.find(n=>n.id==='alpha')
      const cx=viewer.camera.x+viewer.stage.clientWidth/(2*viewer.camera.zoom), cy=viewer.camera.y+viewer.stage.clientHeight/(2*viewer.camera.zoom)
      return {playing,say,opened:viewer.step,focused:Math.abs(cx-alpha.x-alpha.width/2)<1&&Math.abs(cy-alpha.y-alpha.height/2)<1}
    `)
    expect(result).toEqual({
      playing: 1,
      say: 'Refined transform explanation.',
      opened: null,
      focused: true,
    })
  }, 120_000)
  it('provides a native per-leaf way back without readopting it and adopts another leaf', () => {
    const result = run<{ native: string; next: string }>(`
      const v = view(), file = app.vault.getAbstractFileByPath(path)
      v.containerEl.querySelector('[aria-label="Open in Obsidian Canvas"]').click(); await wait(500)
      const native = app.workspace.getLeavesOfType('canvas').find(l => l.view.file?.path === path)
      const leaf = app.workspace.getLeaf('tab'); await leaf.openFile(file); await app.workspace.revealLeaf(leaf); await wait(600)
      return { native: native?.view.getViewType(), next: leaf.view.getViewType() }
    `)
    expect(result).toEqual({ native: 'canvas', next: 'abele-canvas' })
  }, 120_000)
  it('exports the current view and every step without changing the canvas', () => {
    const result = run<{ png: number; svg: number; safe: boolean; same: boolean }>(`
      const v = view(), file = app.vault.getAbstractFileByPath(path), before = await app.vault.read(file)
      window.__canvasViewerExports = []
      const png = await v.exportPicture('png', false); window.__canvasViewerExports.push(...png.map(f => f.path))
      const svg = await v.exportPicture('svg', true); window.__canvasViewerExports.push(...svg.map(f => f.path))
      const safe = (await Promise.all(svg.map(f => app.vault.read(f)))).every(s => s.startsWith('<svg') && s.includes('data:image/png;base64,') && !s.includes('<script'))
      return { png: png.length, svg: svg.length, safe, same: before === await app.vault.read(file) }
    `)
    expect(result).toEqual({ png: 1, svg: 3, safe: true, same: true })
  }, 120_000)
})
