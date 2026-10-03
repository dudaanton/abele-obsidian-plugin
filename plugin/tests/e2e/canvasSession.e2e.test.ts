import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { screenshot } from './helpers/phone'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const DIR = 'Sample shared session'
const SHOTS = shotDir('canvas-session')
const PRELUDE = `
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const path = ${JSON.stringify(`${DIR}/sample.canvas`)}
  const scope = new window.__abeleTest.ScopeResolver(); scope.setFullVaultAccess(true)
  const ctx = { scope, interactive: true }
  const tools = Object.fromEntries(window.__abeleTest.createAgentTools().map(t => [t.name, t]))
  const read = async () => JSON.parse((await tools.canvas_read.execute('sample-read', { path, detail: 'full' }, undefined, ctx)).content[0].text)
  const views = () => app.workspace.getLeavesOfType('abele-canvas').map(l => l.view).filter(v => v.file?.path === path)
`
const run = <T>(body: string): T => evalAsync<T>(`(async () => { ${PRELUDE} ${body} })()`, 120_000)

describe.skipIf(!available)('shared Abele sessions at the live storage boundary', () => {
  beforeAll(() => {
    run(`
      if (app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})) throw new Error('Synthetic folder already exists')
      window.__sessionLayout = app.workspace.getLayout()
      window.__sessionPreference = window.__abeleTest.AbeleConfig.getInstance().canvasViewer
      window.__abeleTest.AbeleConfig.getInstance().canvasViewer = true
      await app.vault.createFolder(${JSON.stringify(DIR)}); window.__sessionOwned = true
      await tools.canvas_create.execute('sample-create', { path, from: { graph: { nodes: [{ id: 'sample-card', kind: 'text', label: 'Shared original' }], edges: [] } } }, undefined, ctx)
      for (let i = 0; i < 2; i++) await app.workspace.getLeaf('tab').setViewState({ type: 'abele-canvas', state: { file: path }, active: true })
      for (let i = 0; i < 60 && (views().length !== 2 || views().some(v => !v.documentLease)); i++) await wait(50)
      return true
    `)
  }, 120_000)
  afterAll(() => {
    run(`
      for (const view of views()) view.documentLease?.document.discardDraft()
      const leaves = []; app.workspace.iterateAllLeaves(l => { if (l.view.file?.path.startsWith(${JSON.stringify(DIR + '/')})) leaves.push(l) }); leaves.forEach(l => l.detach())
      if (window.__sessionOwned) { const folder = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)}); if (folder) await app.vault.delete(folder, true) }
      if (window.__sessionPreference !== undefined) window.__abeleTest.AbeleConfig.getInstance().canvasViewer = window.__sessionPreference
      if (window.__sessionLayout) await app.workspace.changeLayout(window.__sessionLayout)
      delete window.__sessionLayout; delete window.__sessionPreference; delete window.__sessionOwned
      return true
    `)
  }, 120_000)
  it('shares pending content across two read-only leaves and refuses delayed or busy agent publication', () => {
    const result = run<{
      shared: boolean
      pending: string[]
      readPending: string
      busy: boolean
      refused: boolean
      delayed: boolean
      sameBytes: boolean
      pendingStatus: string
    }>(`
      const list = views(), document = list[0].documentLease.document
      const file = app.vault.getAbstractFileByPath(path), before = await app.vault.read(file), approved = await read()
      const shared = list.length === 2 && document === list[1].documentLease.document
      document.beginDraft()
      document.updateDraft(graph => ({ ...graph, nodes: graph.nodes.map(node => node.id === 'sample-card' ? { ...node, text: 'Shared pending draft' } : node) }))
      const pendingRead = await read(), pending = list.map(v => v.viewer.graph.nodes[0].text)
      let refused = false
      try { await tools.canvas_edit.execute('sample-busy', { path, revision: pendingRead.revision, ops: [{ op: 'update', id: 'sample-card', patch: { text: 'Unsafe agent edit' } }] }, undefined, ctx) } catch (error) { refused = /busy|pending/i.test(String(error)) }
      const pendingStatus = list[0].viewer.status.textContent
      document.discardDraft()
      let delayed = false
      try { await tools.canvas_edit.execute('sample-delayed', { path, revision: approved.revision, ops: [{ op: 'update', id: 'sample-card', patch: { text: 'Delayed edit' } }] }, undefined, ctx) } catch (error) { delayed = /changed|reread/i.test(String(error)) }
      return { shared, pending, readPending: pendingRead.nodes[0].data.text, busy: pendingRead.state.busy, refused, delayed, pendingStatus, sameBytes: before === await app.vault.read(file) }
    `)
    expect(result.shared).toBe(true)
    expect(result.pending).toEqual(['Shared pending draft', 'Shared pending draft'])
    expect(result.readPending).toBe('Shared pending draft')
    expect(result.busy).toBe(true)
    expect(result.refused).toBe(true)
    expect(result.delayed).toBe(true)
    expect(result.sameBytes).toBe(true)
    expect(result.pendingStatus).toMatch(/pending|not.*saved/i)
  })
  it('confirms exactly one of two same-revision batches and refreshes both leaves with one history item', () => {
    const result = run<{
      succeeded: number
      failed: number
      text: string[]
      disk: string
      undo: number
      dirty: boolean
    }>(`
      const snapshot = await read(), document = views()[0].documentLease.document
      const batches = ['Committed first batch', 'Committed second batch'].map(text => tools.canvas_edit.execute('sample-race', { path, revision: snapshot.revision, ops: [{ op: 'update', id: 'sample-card', patch: { text } }] }, undefined, ctx))
      const results = await Promise.allSettled(batches)
      for (let i = 0; i < 30 && views().some(v => !v.viewer.graph.nodes[0].text.startsWith('Committed')); i++) await wait(50)
      const file = app.vault.getAbstractFileByPath(path)
      return { succeeded: results.filter(r => r.status === 'fulfilled').length, failed: results.filter(r => r.status === 'rejected').length, text: views().map(v => v.viewer.graph.nodes[0].text), disk: JSON.parse(await app.vault.read(file)).nodes[0].text, undo: document.session.history.undo, dirty: document.session.dirty }
    `)
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.text).toEqual([result.disk, result.disk])
    expect(result.disk).toMatch(/^Committed/)
    expect(result.undo).toBe(1)
    expect(result.dirty).toBe(false)
    if (onPhone()) screenshot(`${SHOTS}/shared-committed.png`)
    else
      run(`
      const image = await require('@electron/remote').getCurrentWebContents().capturePage()
      require('fs').writeFileSync(${JSON.stringify(SHOTS + '/shared-committed.png')}, image.toPNG())
      return true
    `)
  })
})
