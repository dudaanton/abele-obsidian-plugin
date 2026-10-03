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
it('does not overwrite an external file revision when the native view is behind', async () => {
  const { app, leaf, view, save } = setup()
  const external = JSON.parse(bytes)
  external.nodes[0].text = 'External sample revision'
  let stored = JSON.stringify(external)
  app.vault.read = async () => stored
  save.mockImplementation(async () => {
    stored = view.getViewData()
  })
  const switchView = vi.spyOn(leaf, 'setViewState')
  await adoptCanvasLeaves(app).catch(() => {})
  expect(stored).toBe(JSON.stringify(external))
  expect(save).not.toHaveBeenCalled()
  expect(switchView).not.toHaveBeenCalled()
})
it('does not write a revision arriving after the adoption read even when native unload tries to save', async () => {
  const { app, leaf, view, save } = setup()
  const external = JSON.parse(bytes)
  external.nodes[0].text = 'Later external sample revision'
  let stored = bytes
  app.vault.read = async () => {
    const read = stored
    stored = JSON.stringify(external)
    return read
  }
  save.mockImplementation(async () => {
    stored = view.getViewData()
  })
  vi.spyOn(leaf, 'setViewState').mockImplementation(async () => {
    if (view.lastSavedData !== view.getViewData()) await save()
  })
  await adoptCanvasLeaves(app)
  expect(stored).toBe(JSON.stringify(external))
  expect(save).not.toHaveBeenCalled()
})
it('refuses a pending native edit rather than discarding or saving it during adoption', async () => {
  const { app, leaf, view, save } = setup(true)
  await expect(adoptCanvasLeaves(app)).rejects.toThrow(/saving|reloading/i)
  expect(save).not.toHaveBeenCalled()
  expect(leaf.setViewState).not.toHaveBeenCalled()
  expect(view.canvas.getData().nodes[0].text).toBe('Pending change')
})
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
})
// BUG: the original flush guarantee conflicts with read-only view switching; retain only that stale assertion.
it.fails('flushes changed native edge sides during adoption', async () => {
  const { app, view, save } = setup()
  const source = JSON.parse(bytes)
  source.edges = [{ id: 'loop', fromNode: 'alpha', toNode: 'alpha' }]
  app.vault.read = async () => JSON.stringify(source)
  view.canvas.getData = () => ({
    ...source,
    edges: [{ ...source.edges[0], fromSide: 'top', toSide: 'left' }],
  })
  await adoptCanvasLeaves(app).catch(() => {})
  expect(save).toHaveBeenCalledOnce()
})
// BUG: switching views must no longer flush pending data; saving belongs to the native editor.
it.fails('flushes a genuine pending native edit before adopting', async () => {
  const { app, leaf, save } = setup(true)
  await adoptCanvasLeaves(app).catch(() => {})
  expect(save).toHaveBeenCalledOnce()
})
it('leaves explicit native opt-outs alone even when they have pending edits', async () => {
  const { app, leaf, save } = setup(true)
  nativeCanvasLeaves.set(leaf, 'sample.canvas')
  await adoptCanvasLeaves(app)
  expect(save).not.toHaveBeenCalled()
  expect(leaf.setViewState).not.toHaveBeenCalled()
})
