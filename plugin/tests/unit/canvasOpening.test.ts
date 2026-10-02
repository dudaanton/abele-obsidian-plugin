import { expect, it, vi } from 'vitest'
import { type App, type WorkspaceLeaf, TFile } from 'obsidian'
import { adoptCanvasLeaves, nativeCanvasLeaves } from '@/canvas/opening'
const bytes = JSON.stringify({
  edges: [],
  nodes: [{ id: 'alpha', type: 'text', text: 'Alpha', x: 0, y: 0, width: 200, height: 100 }],
})
const setup = (changed = false) => {
  const file = new TFile()
  file.path = 'sample.canvas'
  file.extension = 'canvas'
  const data = JSON.parse(bytes)
  if (changed) data.nodes[0].text = 'Pending change'
  const serialized = JSON.stringify({ nodes: data.nodes, edges: data.edges }, null, 2)
  const save = vi.fn(async () => {})
  const cancel = vi.fn()
  const view = {
    file,
    getViewType: () => 'canvas',
    canvas: { getData: () => data },
    getViewData: () => serialized,
    lastSavedData: bytes,
    requestSave: { cancel },
    save,
  }
  const leaf = {
    view,
    getViewState: () => ({ type: 'canvas', state: { file: file.path } }),
    setViewState: vi.fn(async () => {}),
  }
  const app = {
    vault: { read: async () => bytes, getAbstractFileByPath: () => file },
    workspace: { getLeavesOfType: () => [leaf] },
  }
  return {
    app: app as unknown as App,
    leaf: leaf as unknown as WorkspaceLeaf,
    view,
    save,
    cancel,
    serialized,
  }
}
it('adopts semantically unchanged native data without triggering a formatting-only save on unload', async () => {
  const { app, view, save, cancel, serialized } = setup()
  await adoptCanvasLeaves(app)
  expect(save).not.toHaveBeenCalled()
  expect(cancel).toHaveBeenCalledOnce()
  expect(view.lastSavedData).toBe(serialized)
})
it('does not treat native default edge sides as a pending edit', async () => {
  const { app, view, save } = setup()
  const source = JSON.parse(bytes)
  source.edges = [{ id: 'loop', fromNode: 'alpha', toNode: 'alpha' }]
  app.vault.read = async () => JSON.stringify(source)
  view.canvas.getData = () => ({
    ...source,
    edges: [{ ...source.edges[0], fromSide: 'right', toSide: 'left' }],
  })
  await adoptCanvasLeaves(app)
  expect(save).not.toHaveBeenCalled()
  view.canvas.getData = () => ({
    ...source,
    edges: [{ ...source.edges[0], fromSide: 'top', toSide: 'left' }],
  })
  await adoptCanvasLeaves(app)
  expect(save).toHaveBeenCalledOnce()
})
it('flushes a genuine pending native edit before adopting, and leaves explicit opt-outs alone', async () => {
  const { app, leaf, save } = setup(true)
  await adoptCanvasLeaves(app)
  expect(save).toHaveBeenCalledOnce()
  nativeCanvasLeaves.set(leaf, 'sample.canvas')
  await adoptCanvasLeaves(app)
  expect(save).toHaveBeenCalledOnce()
})
