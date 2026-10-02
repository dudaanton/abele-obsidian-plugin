import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { evalJson, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

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
      leaves.forEach(l => l.detach())
      const dir = window.__canvasAgentOwned ? app.vault.getAbstractFileByPath(${JSON.stringify(DIR)}) : null; if (dir) await app.vault.delete(dir, true)
      delete window.__canvasAgentOwned
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

  it('imports a nested Mermaid flowchart using the bundled parser', () => {
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
})
