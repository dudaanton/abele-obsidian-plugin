import { describe, expect, it, vi } from 'vitest'
import { TFile, type App } from 'obsidian'
import { buildFakeVault } from '../helpers/fakeVault'
import { canvasDocuments } from '@/canvas/documentRegistry'
import { ObsidianCanvasStore } from '@/canvas/obsidianStore'
import { parseCanvas, serializeCanvas } from '@/canvas/core/model'
import { planCanvasEdit } from '@/canvas/core/service'

const path = 'sample.canvas',
  old = 'sample-assets/sample-image.svg',
  moved = 'sample-assets/sample-renamed.svg'
const initial = parseCanvas({
  nodes: [
    {
      id: 'image',
      type: 'file',
      file: old,
      subpath: '#sample',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      future: { file: old },
    },
    { id: 'group', type: 'group', background: old, x: -20, y: -20, width: 200, height: 200 },
    { id: 'text', type: 'text', text: 'Sample text', x: 300, y: 0, width: 100, height: 100 },
  ],
  edges: [],
  future: { file: old },
})
const edit = (x: number) => (graph: typeof initial) =>
  planCanvasEdit(graph, [{ op: 'update', id: 'image', patch: { x } }])
async function setup() {
  const app = buildFakeVault([
    { path, raw: serializeCanvas(initial) },
    { path: old, raw: '<svg/>' },
  ])
  Object.assign(app, { workspace: { getLeavesOfType: () => [] } })
  const host = app as unknown as App,
    store = new ObsidianCanvasStore(host),
    file = app.vault.getAbstractFileByPath(path) as TFile
  const lease = await store.open(file, {})
  const asset = app.vault.getAbstractFileByPath(old) as TFile
  const rename = async () => {
    await app.vault.rename(asset, moved)
    app.emit('vault', 'rename', asset, old)
  }
  const nativeRewrite = async () => {
    const graph = parseCanvas(await app.vault.read(file))
    graph.nodes[0].file = moved
    graph.nodes[1].background = moved
    await app.vault.modify(file, serializeCanvas(graph))
    app.emit('vault', 'modify', file)
    await canvasDocuments(host).flush(file)
  }
  return { app, host, store, file, lease, rename, nativeRewrite }
}
describe('canvas rename closure', () => {
  it('blocks publication between the rename event and the native reference rewrite', async () => {
    const { app, store, file, lease, rename } = await setup()
    lease.document.beginDraft()
    lease.document.updateDraft(edit(40))
    lease.document.finishDraft()
    await rename()
    const process = vi.spyOn(app.vault, 'process')
    await expect(store.publishDraft(file)).rejects.toThrow(/conflict|rename/i)
    expect(process).not.toHaveBeenCalled()
    expect(lease.document.session.graph.nodes[0].x).toBe(40)
  })
  it('reconciles a dirty draft and undo/redo only with the confirmed standard-field rewrite', async () => {
    const { app, store, file, lease, rename, nativeRewrite } = await setup()
    const first = await store.snapshot(path)
    await store.change(path, first.revision, edit(20))
    lease.document.beginDraft()
    lease.document.updateDraft(edit(40))
    lease.document.finishDraft()
    await rename()
    await nativeRewrite()
    expect(lease.document.session.conflict).toBe(false)
    expect(lease.document.session.graph.nodes[0]).toMatchObject({
      file: moved,
      x: 40,
      subpath: '#sample',
      future: { file: old },
    })
    const saved = await store.publishDraft(file)
    const undo = await store.undo(path, saved.revision)
    expect(undo.after.nodes[0]).toMatchObject({ file: moved, x: 20 })
    const undoAgain = await store.undo(path, undo.revision)
    expect(undoAgain.after.nodes[0]).toMatchObject({ file: moved, x: 0 })
    const redo = await store.redo(path, undoAgain.revision)
    expect(redo.after.nodes[0]).toMatchObject({ file: moved, x: 20 })
    expect(parseCanvas(await app.vault.read(file)).future).toEqual({ file: old })
  })
  it('refuses an agent batch whose attachment moves at the final write boundary', async () => {
    const { app, store, file, lease, rename } = await setup()
    const snapshot = await store.snapshot(path),
      process = app.vault.process.bind(app.vault)
    vi.spyOn(app.vault, 'process').mockImplementationOnce(async (target, transform) => {
      await rename()
      return process(target, transform)
    })
    await expect(store.change(path, snapshot.revision, edit(50))).rejects.toThrow(
      /stale|conflict|rename|changed/i
    )
    expect(parseCanvas(await app.vault.read(file))).toEqual(initial)
    expect(lease.document.session.history.undo).toBe(0)
  })
  it('does not expose a stale captured agent planner as Reapply after an in-flight rename', async () => {
    const { app, host, store, file, lease, rename } = await setup()
    const snapshot = await store.snapshot(path),
      process = app.vault.process.bind(app.vault)
    vi.spyOn(app.vault, 'process').mockImplementationOnce(async (target, transform) => {
      await rename()
      return process(target, transform)
    })
    const captured = edit(50)(initial)
    await expect(
      store.change(path, snapshot.revision, () => captured, undefined, {
        actor: 'sample-agent',
        tool: 'canvas_edit',
      })
    ).rejects.toThrow(/rename/i)
    const external = edit(90)(initial)
    external.nodes[0].file = moved
    external.nodes[1].background = moved
    await app.vault.modify(file, serializeCanvas(external))
    app.emit('vault', 'modify', file)
    await canvasDocuments(host).flush(file)
    expect(lease.document.recovery).toBeNull()
    expect(lease.document.session.graph.nodes[0].x).toBe(50)
  })
  it('rejects a closed-canvas agent write when an attachment moves during its transaction', async () => {
    const { app, store, file, lease, rename } = await setup()
    lease.release()
    const snapshot = await store.snapshot(path),
      process = app.vault.process.bind(app.vault)
    vi.spyOn(app.vault, 'process').mockImplementationOnce(async (target, transform) => {
      await rename()
      return process(target, transform)
    })
    await expect(store.change(path, snapshot.revision, edit(60))).rejects.toThrow(/rename|changed/i)
    expect(parseCanvas(await app.vault.read(file))).toEqual(initial)
  })
  it('retains dirty text and refuses stale retry when native rename rewrites its links', async () => {
    const { app, host, store, file, lease, rename } = await setup()
    const withLink = parseCanvas(await app.vault.read(file))
    withLink.nodes[2].text = '[[sample-assets/sample-image.svg#sample|Picture]]'
    await app.vault.modify(file, serializeCanvas(withLink))
    app.emit('vault', 'modify', file)
    await canvasDocuments(host).flush(file)
    lease.document.beginDraft()
    lease.document.updateDraft((g) =>
      planCanvasEdit(g, [
        { op: 'update', id: 'text', patch: { text: withLink.nodes[2].text + ' Human draft' } },
      ])
    )
    lease.document.finishDraft()
    await rename()
    const rewritten = { ...withLink, nodes: withLink.nodes.map((n) => ({ ...n })) }
    rewritten.nodes[0].file = moved
    rewritten.nodes[1].background = moved
    rewritten.nodes[2].text = '[[sample-assets/sample-renamed.svg#sample|Picture]]'
    await app.vault.modify(file, serializeCanvas(rewritten))
    app.emit('vault', 'modify', file)
    await canvasDocuments(host).flush(file)
    await expect(store.publishDraft(file)).rejects.toThrow(/conflict/i)
    expect(lease.document.session.graph.nodes[2].text).toContain('Human draft')
    expect(parseCanvas(await app.vault.read(file))).toEqual(rewritten)
  })
  it('blocks old history if a native rewrite is observed before its rename event', async () => {
    const { app, host, store, file, lease, rename, nativeRewrite } = await setup()
    const snapshot = await store.snapshot(path)
    await store.change(path, snapshot.revision, edit(20))
    await nativeRewrite()
    await rename()
    await canvasDocuments(host).flush(file)
    const current = await store.snapshot(path)
    await expect(store.undo(path, current.revision)).rejects.toThrow(/conflict/i)
    expect(parseCanvas(await app.vault.read(file)).nodes[0]).toMatchObject({ file: moved, x: 20 })
    expect(lease.document.session.history.undo).toBe(1)
  })
  it('never reconciles unrelated native edits into a dirty draft', async () => {
    const { app, host, store, file, lease, rename } = await setup()
    lease.document.beginDraft()
    lease.document.updateDraft(edit(40))
    lease.document.finishDraft()
    await rename()
    const external = edit(90)(initial)
    external.nodes[0].file = moved
    external.nodes[1].background = moved
    await app.vault.modify(file, serializeCanvas(external))
    app.emit('vault', 'modify', file)
    await canvasDocuments(host).flush(file)
    await expect(store.publishDraft(file)).rejects.toThrow(/conflict/i)
    expect(lease.document.session.graph.nodes[0].x).toBe(40)
    expect(parseCanvas(await app.vault.read(file)).nodes[0].x).toBe(90)
  })
})
