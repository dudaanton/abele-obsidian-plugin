import { expect, it, vi } from 'vitest'
import { CanvasView } from '@/canvas/CanvasView'
import { CanvasViewer } from '@/canvas/Viewer'

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
  ;(view as unknown as { bytes: string }).bytes = 'sample loaded data'
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
  ;(view as unknown as { bytes: string }).bytes = 'sample loaded data'
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
