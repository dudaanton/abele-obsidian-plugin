import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { evalAsync } from './helpers/githubLive'
import { evalJson, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { closeFixtureLeaves } from './helpers/fixtureBoundary'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const DIR = 'Sample canvas agent'
const SHOTS = shotDir('canvas-agent')
const mobile = process.env.CANVAS_AGENT_MOBILE === '1'
const PRELUDE = `
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const scope = new window.__abeleTest.ScopeResolver()
  scope.setFullVaultAccess(true)
  const ctx = { scope, interactive: true }
  const tools = Object.fromEntries(window.__abeleTest.createAgentTools().map(t => [t.name, t]))
  const call = async (name, params) => {
    if (['canvas_edit', 'canvas_layout'].includes(name) && !params.revision) {
      const read = await tools.canvas_read.execute('sample-read', { path: params.path }, undefined, ctx)
      params = { ...params, revision: JSON.parse(read.content[0].text).revision }
    }
    return tools[name].execute('sample-call', params, undefined, ctx)
  }
  const parsed = result => JSON.parse(result.content[0].text)
  const path = ${JSON.stringify(`${DIR}/sample.canvas`)}
  const read = async () => parsed(await call('canvas_read', { path, detail: 'full' }))
  const text = data => data.nodes.find(n => n.id === 'alpha').data.text
`
const run = <T>(body: string): T => evalAsync<T>(`(async () => { ${PRELUDE} ${body} })()`, 120_000)

describe.skipIf(!available)('agent explanatory diagrams in native Canvas', () => {
  let size: number[] | null = null
  beforeAll(async () => {
    if (mobile && !onPhone()) {
      size = evalJson<number[]>(`require('@electron/remote').getCurrentWindow().getContentSize()`)
      evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390, 844)`)
      await reloadApp('app.emulateMobile(true)')
    }
    run(`
      if (app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})) throw new Error('Synthetic folder already exists')
      window.__canvasAgentLayout = app.workspace.getLayout()
      window.__canvasAgentPreference = window.__abeleTest.AbeleConfig.getInstance().canvasViewer
      window.__abeleTest.AbeleConfig.getInstance().canvasViewer = false
      await app.vault.createFolder(${JSON.stringify(DIR)})
      window.__canvasAgentOwned = true
      await app.vault.create(${JSON.stringify(`${DIR}/sample-note.md`)}, '# Sample note\\nVisible note content.\\n![[sample-image.svg]]')
      await app.vault.create(${JSON.stringify(`${DIR}/sample-image.svg`)}, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><rect width="100" height="40" fill="green"/><circle cx="50" cy="20" r="12" fill="white"/></svg>')
      return true
    `)
  }, 120_000)
  afterAll(async () => {
    run(`
      const leaves = []; app.workspace.iterateAllLeaves(l => { if (l.view.file?.path.startsWith(${JSON.stringify(DIR + '/')})) leaves.push(l) })
      await (${closeFixtureLeaves.toString()})(leaves)
      const dir = window.__canvasAgentOwned ? app.vault.getAbstractFileByPath(${JSON.stringify(DIR)}) : null; if (dir) await app.vault.delete(dir, true)
      delete window.__canvasAgentOwned
      if (window.__canvasAgentPreference !== undefined) window.__abeleTest.AbeleConfig.getInstance().canvasViewer = window.__canvasAgentPreference
      delete window.__canvasAgentPreference
      if (window.__canvasAgentLayout) await app.workspace.changeLayout(window.__canvasAgentLayout)
      delete window.__canvasAgentLayout
      delete window.__canvasAgentPicture
      return true
    `)
    if (mobile && !onPhone()) {
      if (size)
        evalRaw(
          `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]})`
        )
      await reloadApp('app.emulateMobile(false)')
    }
  }, 120_000)

  it('creates from meaning, lays out, edits by id and opens a native canvas', () => {
    const r = run<{ type: string; ids: string[]; overlap: number; atomic: boolean }>(`
      await call('canvas_create', { path, title: 'Sample explanation', from: { graph: { nodes: [
        { id: 'alpha', kind: 'shape', shape: 'diamond', label: 'Sample concept' },
        { id: 'beta', kind: 'shape', shape: 'database', label: 'Sample storage' },
        { id: 'note', kind: 'note', file: ${JSON.stringify(`${DIR}/sample-note.md`)}, width: 300, height: 240 },
      ], edges: [{ id: 'flow', fromNode: 'alpha', toNode: 'beta', label: 'next', styleAttributes: { path: 'dashed' } }] } } })
      const before = await app.vault.read(app.vault.getAbstractFileByPath(path))
      try { await call('canvas_edit', { path, ops: [{ op: 'update', id: 'alpha', patch: { text: 'No partial edit' } }, { op: 'update', id: 'missing', patch: { text: 'No' } }] }) } catch {}
      const atomic = before === await app.vault.read(app.vault.getAbstractFileByPath(path))
      const leaf = app.workspace.getLeaf('tab'); await leaf.openFile(app.vault.getAbstractFileByPath(path)); await app.workspace.revealLeaf(leaf); await wait(800)
      const data = await read()
      return { type: leaf.view.getViewType(), ids: data.nodes.map(n => n.id), overlap: data.warnings.filter(w => w.code === 'overlap').length, atomic }
    `)
    expect(r).toEqual({ type: 'canvas', ids: ['alpha', 'beta', 'note'], overlap: 0, atomic: true })
  }, 120_000)

  it('makes a whole agent batch one native undo and redo item', () => {
    const r = run<{ edited: string; undo: string; redo: string; delta: number }>(`
      const view = app.workspace.getLeavesOfType('canvas').find(l => l.view.file?.path === path).view
      const before = view.canvas.history.current
      await call('canvas_edit', { path, ops: [{ op: 'update', id: 'alpha', patch: { text: 'Changed sample concept' } }, { op: 'style', id: 'alpha', styleAttributes: { border: 'dotted' } }] })
      await wait(900)
      const edited = text(await read()), delta = view.canvas.history.current - before
      view.canvas.undo(); await wait(300)
      const undo = text(await read())
      view.canvas.redo(); await wait(300)
      return { edited, undo, redo: text(await read()), delta }
    `)
    expect(r).toEqual({
      edited: 'Changed sample concept',
      undo: 'Sample concept',
      redo: 'Changed sample concept',
      delta: 1,
    })
  }, 120_000)

  it('keeps a pending native edit as the undo baseline for the agent batch', () => {
    const r = run<{ pending: string; undo: string; twice: string; redo: string }>(`
      const view = app.workspace.getLeavesOfType('canvas').find(l => l.view.file?.path === path).view
      view.canvas.nodes.get('alpha').setText('Native pending sample')
      view.canvas.requestSave()
      const pending = text(await read())
      await call('canvas_edit', { path, ops: [{ op: 'update', id: 'alpha', patch: { text: 'Agent after pending' } }] })
      view.canvas.undo(); await wait(100)
      const undo = text(await read())
      view.canvas.undo(); await wait(100)
      const twice = text(await read())
      view.canvas.redo(); view.canvas.redo(); await wait(100)
      return { pending, undo, twice, redo: text(await read()) }
    `)
    expect(r).toEqual({
      pending: 'Native pending sample',
      undo: 'Native pending sample',
      twice: 'Changed sample concept',
      redo: 'Agent after pending',
    })
  }, 120_000)

  it('refuses a stale native edit without replacing the owner text', () => {
    const r = run<{ refused: boolean; owner: string }>(`
      const snapshot = await read()
      const view = app.workspace.getLeavesOfType('canvas').find(l => l.view.file?.path === path).view
      view.canvas.nodes.get('alpha').setText('Owner revised sample')
      view.canvas.requestSave()
      let refused = false
      try { await tools.canvas_edit.execute('stale-sample', { path, revision: snapshot.revision, ops: [{ op: 'update', id: 'alpha', patch: { text: 'Stale agent sample' } }] }, undefined, ctx) }
      catch (error) { refused = /changed since|reread/i.test(error.message) }
      return { refused, owner: view.canvas.nodes.get('alpha').text }
    `)
    expect(r).toEqual({ refused: true, owner: 'Owner revised sample' })
  }, 120_000)

  it('imports a nested Mermaid flowchart using the pele parser', () => {
    const r = run<{
      ids: string[]
      edges: number
      parents: Record<string, string | null>
      delta: number
      undo: string
      redo: string
    }>(`
      const target = ${JSON.stringify(`${DIR}/mermaid.canvas`)}
      await call('canvas_create', { path: target, from: { mermaid: 'flowchart LR\\nsubgraph overview[Overview]\\nsubgraph detail[Detail]\\nalpha[Alpha] -->|next| beta{Beta}\\nend\\nend\\nbeta --> gamma[(Storage)]' } })
      const data = parsed(await call('canvas_read', { path: target, detail: 'full' }))
      const leaf = app.workspace.getLeaf('tab'); await leaf.openFile(app.vault.getAbstractFileByPath(target)); await app.workspace.revealLeaf(leaf); await wait(900)
      const view = leaf.view, before = view.canvas.history.current
      await call('canvas_edit', { path: target, ops: [{ op: 'update', id: 'alpha', patch: { text: 'Mermaid refined' } }, { op: 'style', id: 'alpha', styleAttributes: { border: 'dotted' } }] })
      await wait(900)
      const delta = view.canvas.history.current - before
      view.canvas.undo(); const undo = view.canvas.nodes.get('alpha').text
      view.canvas.redo(); const redo = view.canvas.nodes.get('alpha').text
      return { ids: data.nodes.map(n => n.id), edges: data.edges.length, parents: Object.fromEntries(data.nodes.map(n => [n.id, n.parent])), delta, undo, redo }
    `)
    expect(r.ids).toEqual(['alpha', 'beta', 'detail', 'gamma', 'overview'])
    expect(r.edges).toBe(2)
    expect(r.delta).toBe(1)
    expect(r.undo).toBe('Alpha')
    expect(r.redo).toBe('Mermaid refined')
    expect(r.parents).toEqual({
      alpha: 'detail',
      beta: 'detail',
      detail: 'overview',
      gamma: null,
      overview: null,
    })
  }, 120_000)

  it('renders pele diagrams inside a canvas note card', () => {
    const result = run<{ drawn: boolean; shots: string[] }>(`
      const notePath = ${JSON.stringify(DIR + '/diagram-note.md')}
      await app.vault.create(notePath, '# Sample diagram\\n\\n' + '\`\`\`pele\\nflowchart LR\\n A[Draft] --> B[Done]\\n\`\`\`')
      const target = ${JSON.stringify(DIR + '/diagram-card.canvas')}
      await call('canvas_create', { path: target, from: { graph: { nodes: [
        { id: 'diagram-note', kind: 'note', file: notePath, width: 520, height: 380 }
      ] } } })
      const leaf = app.workspace.getLeaf(true)
      await leaf.openFile(app.vault.getAbstractFileByPath(target))
      const deadline = Date.now() + 20000
      while (!leaf.view.containerEl.querySelector('svg.pele') && Date.now() < deadline) await wait(100)
      const drawn = !!leaf.view.containerEl.querySelector('svg.pele')
      const shots = []
      if (drawn && window.__e2eHost) {
        const path = ${JSON.stringify(SHOTS)} + '/pele-canvas-card-phone.png'
        await window.__e2eHost.shot(path)
        shots.push(path)
      } else if (drawn && typeof require === 'function') {
        const win = require('@electron/remote').getCurrentWindow()
        const original = win.getContentSize()
        const panels = [app.workspace.leftSplit.collapsed, app.workspace.rightSplit.collapsed]
        try {
          app.workspace.leftSplit.collapse()
          app.workspace.rightSplit.collapse()
          await app.workspace.revealLeaf(leaf)
          require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
          for (const width of [1280, 390]) {
            win.setContentSize(width, width === 390 ? 844 : 800)
            await wait(500)
            leaf.view.canvas.zoomToFit()
            await wait(500)
            const bounds = leaf.view.containerEl.querySelector('svg.pele').getBoundingClientRect()
            if (bounds.width < 40 || bounds.height <= 0 || bounds.left < 0 || bounds.right > innerWidth)
              throw new Error('Canvas diagram is outside the screenshot viewport')
            const image = await require('@electron/remote').getCurrentWebContents().capturePage()
            const path = ${JSON.stringify(SHOTS)} + '/pele-canvas-card-' + width + '.png'
            require('fs').writeFileSync(path, image.toPNG())
            shots.push(path)
          }
        } finally {
          win.setContentSize(...original)
          if (!panels[0]) app.workspace.leftSplit.expand()
          if (!panels[1]) app.workspace.rightSplit.expand()
        }
      }
      return { drawn, shots }
    `)
    expect(result.drawn).toBe(true)
    if (!onPhone()) expect(result.shots).toHaveLength(2)
  }, 120_000)

  it('measures, fits, aligns and distributes cards and checks multiple regions without an open tab', () => {
    const result = run<{
      measured: number
      fitted: number
      tops: number[]
      crops: number
      images: number
      urls: string[]
    }>(`
      const precise = ${JSON.stringify(`${DIR}/precise.canvas`)}
      await call('canvas_create', { path: precise, from: { graph: { nodes: [
        { id: 'first', kind: 'text', label: '# Sample heading\\nA short explanation with **bold words**.' },
        { id: 'second', kind: 'text', label: 'Another sample card.' },
        { id: 'third', kind: 'text', label: 'Last sample card.' }
      ] } } })
      await call('canvas_edit', { path: precise, ops: [
        { op: 'update', id: 'first', patch: { x: 0, y: 0, width: 240, height: 800 } },
        { op: 'update', id: 'second', patch: { x: 400, y: 80 } },
        { op: 'update', id: 'third', patch: { x: 800, y: 160 } }
      ] })
      const before = parsed(await call('canvas_read', { path: precise, measure: ['first'] }))
      await call('canvas_edit', { path: precise, ops: [
        { op: 'fit', ids: ['first', 'second', 'third'] },
        { op: 'align', ids: ['first', 'second', 'third'], axis: 'top' },
        { op: 'distribute', ids: ['first', 'second', 'third'], axis: 'horizontal', gap: 80 }
      ] })
      const file = JSON.parse(await app.vault.read(app.vault.getAbstractFileByPath(precise)))
      const pictures = await call('look_at_canvas', { path: precise, regions: [{ node: 'first' }, { node: 'second' }], maxSide: 800 })
      const images = pictures.injectMessages[0].content.filter(p => p.type === 'image_url')
      return { measured: before.measurements[0].height, fitted: file.nodes[0].height, tops: file.nodes.map(n => n.y), crops: parsed(pictures).shots.length, images: images.length, urls: images.map(image => image.image_url.url) }
    `)
    expect(result.measured).toBeGreaterThan(32)
    expect(result.measured).toBeLessThan(800)
    expect(result.fitted).toBe(result.measured)
    expect(new Set(result.tops).size).toBe(1)
    expect(result.crops).toBe(2)
    expect(result.images).toBe(2)
    result.urls.forEach((url, index) =>
      writeFileSync(
        `${SHOTS}/precise-region-${index}.png`,
        Buffer.from(url.split(',')[1], 'base64')
      )
    )
  }, 120_000)

  it('returns crop PNGs, scoped note content and local images with clipping diagnostics', () => {
    const r = run<{
      url: string
      width: number
      height: number
      visible: string[]
      clipping: boolean
      image: boolean
    }>(`
      const result = await call('look_at_canvas', { path, node: 'note', maxSide: 800 })
      const data = parsed(result)
      const url = result.injectMessages[0].content.find(p => p.type === 'image_url').image_url.url
      window.__canvasAgentPicture = url
      if (!window.__e2eHost) require('fs').writeFileSync(${JSON.stringify(SHOTS + '/note-crop.png')}, Buffer.from(url.split(',')[1], 'base64'))
      await call('canvas_edit', { path, ops: [{ op: 'update', id: 'alpha', patch: { text: 'Sample long explanation '.repeat(200), height: 40 } }] })
      const clipped = parsed(await call('look_at_canvas', { path, node: 'alpha' }))
      return { url: url.slice(0, 30), width: data.width, height: data.height, visible: data.visible, clipping: clipped.warnings.some(w => w.code === 'clipped-text' && w.ids.includes('alpha')), image: !data.warnings.some(w => w.code === 'unavailable-image') }
    `)
    expect(r.url).toMatch(/^data:image\/png;base64,/)
    expect(Math.max(r.width, r.height)).toBe(800)
    expect(r.visible).toContain('note')
    expect(r.clipping).toBe(true)
    expect(r.image).toBe(true)
  }, 120_000)

  it('writes on the first attempt after reading an idle open Abele canvas', () => {
    const result = run<{ unchanged: boolean; stable: boolean; text: string; history: number }>(`
      const target = ${JSON.stringify(`${DIR}/idle.canvas`)}
      await call('canvas_create', { path: target, from: { graph: { nodes: [{ id: 'idle-card', kind: 'text', label: 'Idle sample' }], edges: [] } } })
      const file = app.vault.getAbstractFileByPath(target), before = await app.vault.read(file)
      const leaf = app.workspace.getLeaf('tab')
      try {
        await leaf.setViewState({ type: 'abele-canvas', state: { file: target }, active: true })
        await app.workspace.revealLeaf(leaf)
        for (let i = 0; i < 60 && !leaf.view.documentLease; i++) await wait(50)
        if (!leaf.view.documentLease) throw new Error('Abele canvas did not attach')
        const snapshot = parsed(await call('canvas_read', { path: target }))
        await wait(1800)
        const idle = parsed(await call('canvas_read', { path: target }))
        const unchanged = before === await app.vault.read(file)
        await tools.canvas_edit.execute('sample-idle-write', { path: target, revision: snapshot.revision, ops: [{ op: 'update', id: 'idle-card', patch: { text: 'First attempt succeeded' } }] }, undefined, ctx)
        return { unchanged, stable: idle.revision === snapshot.revision, text: JSON.parse(await app.vault.read(file)).nodes[0].text, history: leaf.view.documentLease.document.session.history.undo }
      } finally {
        await (${closeFixtureLeaves.toString()})([leaf])
      }
    `)
    expect(result).toEqual({
      unchanged: true,
      stable: true,
      text: 'First attempt succeeded',
      history: 1,
    })
  }, 120_000)
})
