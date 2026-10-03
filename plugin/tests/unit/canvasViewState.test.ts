import { expect, it, vi } from 'vitest'
import { CanvasView } from '@/canvas/CanvasView'
import { CanvasViewer } from '@/canvas/Viewer'
import { TFile } from 'obsidian'

it.each(['', '{}'])(
  'loads the untouched native empty state %j without hiding nonempty malformed data',
  async (initialBytes) => {
    const view = Object.create(CanvasView.prototype) as CanvasView
    const load = vi.fn(),
      setText = vi.fn()
    view.viewer = { load, status: { setText } } as unknown as CanvasViewer
    const file = Object.assign(new TFile(), { path: 'sample-empty.canvas' })
    let bytes = initialBytes
    ;(view as unknown as { app: unknown; refreshToken: number }).app = {
      vault: { read: async () => bytes },
    }
    ;(view as unknown as { refreshToken: number }).refreshToken = 0
    await view.onLoadFile(file)
    expect(load).toHaveBeenCalledWith({ nodes: [], edges: [] }, true)
    expect(setText).not.toHaveBeenCalled()
    bytes = '{"nodes":[]'
    await (view as unknown as { refresh(): Promise<void> }).refresh()
    expect(load).toHaveBeenCalledOnce()
    expect(setText).toHaveBeenCalledWith(expect.stringMatching(/could not be read/i))
    expect(bytes).toBe('{"nodes":[]')
  }
)

it.each([
  { nodes: [], edges: [] },
  {
    nodes: [
      { id: 'sample', type: 'text', text: 'Sample content', x: 0, y: 0, width: 200, height: 100 },
    ],
    edges: [],
  },
])('reports a read error for a JSON-string-wrapped graph %# without loading it', async (graph) => {
  const view = Object.create(CanvasView.prototype) as CanvasView
  const load = vi.fn(),
    setText = vi.fn()
  view.viewer = { load, status: { setText } } as unknown as CanvasViewer
  const file = Object.assign(new TFile(), { path: 'sample-invalid.canvas' })
  const bytes = JSON.stringify(JSON.stringify(graph))
  ;(view as unknown as { app: unknown; refreshToken: number }).app = {
    vault: { read: async () => bytes },
  }
  ;(view as unknown as { refreshToken: number }).refreshToken = 0
  await view.onLoadFile(file)
  expect(load).not.toHaveBeenCalled()
  expect(setText).toHaveBeenCalledWith(expect.stringMatching(/could not be read/i))
  expect((view as unknown as { bytes: string | null }).bytes).toBeNull()
})

it('keeps a readable static view and a steps-specific error when legacy walkthrough data is malformed', async () => {
  const el = document.createElement('div')
  const viewer = new CanvasViewer(el, {
    theme: () => ({}) as never,
    assets: async () => ({}),
    cards: { sync: () => new Set(), destroy: () => {} },
    openNode: () => {},
  })
  viewer.load({
    nodes: [{ id: 'alpha', type: 'text', text: 'Alpha', x: 0, y: 0, width: 240, height: 120 }],
    edges: [],
    abele: { steps: 'broken' },
  })
  const view = Object.create(CanvasView.prototype) as CanvasView
  view.viewer = viewer
  ;(view as unknown as { loaded: boolean }).loaded = true
  try {
    await expect(view.setState({ file: 'sample.canvas', play: false }, {})).resolves.toBeUndefined()
    expect(viewer.scene().graph.nodes).toHaveLength(1)
    expect(viewer.status.textContent).toMatch(/steps/i)
    expect(viewer.status.textContent).not.toMatch(/diagram could not be read/i)
    await expect(
      view.setState({ file: 'sample.canvas', stepId: 'old-step', step: 1 }, {})
    ).resolves.toBeUndefined()
    expect(viewer.step).toBeNull()
    expect(viewer.status.textContent).toMatch(/steps/i)
  } finally {
    viewer.destroy()
  }
})
it('starts the walkthrough for Play on a node embed while Open still frames only that node', async () => {
  const el = document.createElement('div')
  const viewer = new CanvasViewer(el, {
    theme: () => ({}) as never,
    assets: async () => ({}),
    cards: { sync: () => new Set(), destroy: () => {} },
    openNode: () => {},
  })
  viewer.load({
    nodes: [{ id: 'alpha', type: 'text', text: 'Alpha', x: 0, y: 0, width: 240, height: 120 }],
    edges: [],
    abele: { steps: [{ id: 'start', reveal: ['alpha'], say: 'First sample explanation' }] },
  })
  const view = Object.create(CanvasView.prototype) as CanvasView
  view.viewer = viewer
  ;(view as unknown as { loaded: boolean }).loaded = true
  const focus = vi.spyOn(viewer, 'focusRegion')
  try {
    await view.setState({ node: 'alpha', play: true }, {})
    expect(viewer.step).toBe(1)
    expect(viewer.narration.textContent).toBe('First sample explanation')
    await view.setState({ node: 'alpha', play: false }, {})
    expect(viewer.step).toBeNull()
    expect(focus).toHaveBeenLastCalledWith(viewer.graph.nodes[0])
  } finally {
    viewer.destroy()
  }
})
