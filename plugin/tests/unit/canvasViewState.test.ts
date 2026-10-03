import { expect, it, vi } from 'vitest'
import { CanvasView } from '@/canvas/CanvasView'
import { CanvasViewer } from '@/canvas/Viewer'

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
