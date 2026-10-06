import { expect, it, vi } from 'vitest'
import { MarkdownRenderer } from 'obsidian'
import { hostCanvasViewer } from '@/canvas/adapter'
import * as painter from '@/canvas/core/painter'
import { useVault } from '../helpers/testEnv'

it('rerenders text-card links against the new source when a canvas moves', async () => {
  const app = useVault([]),
    el = document.createElement('div')
  document.body.append(el)
  let source = 'sample-first/sample.canvas'
  const render = vi.spyOn(MarkdownRenderer, 'render')
  const viewer = hostCanvasViewer(app as never, el, () => source)
  viewer.load({
    nodes: [
      { id: 'sample', type: 'text', text: '[[sample-note]]', x: 0, y: 0, width: 200, height: 100 },
    ],
    edges: [],
  })
  Object.defineProperties(viewer.stage, {
    clientWidth: { value: 600 },
    clientHeight: { value: 400 },
  })
  const context = vi
    .spyOn(viewer.canvas, 'getContext')
    .mockReturnValue({ setTransform: vi.fn() } as never)
  const paint = vi.spyOn(painter, 'paintCanvas').mockReturnValue({ visible: [], warnings: [] })
  try {
    ;(viewer as unknown as { paint(): void }).paint()
    await Promise.resolve()
    source = 'sample-second/sample.canvas'
    viewer.load(viewer.graph)
    ;(viewer as unknown as { paint(): void }).paint()
    await Promise.resolve()
    expect(render.mock.calls.map((call) => call[3])).toEqual([
      'sample-first/sample.canvas',
      'sample-second/sample.canvas',
    ])
  } finally {
    viewer.destroy()
    el.remove()
    render.mockRestore()
    paint.mockRestore()
    context.mockRestore()
  }
})

it('composites each card background and markdown together so an upper empty card occludes lower text', async () => {
  const app = useVault([]),
    el = document.createElement('div')
  document.body.append(el)
  const viewer = hostCanvasViewer(app as never, el, () => 'sample.canvas')
  viewer.load({
    nodes: [
      { id: 'alpha', type: 'text', text: 'Lower sample text', x: 0, y: 0, width: 240, height: 120 },
      { id: 'beta', type: 'text', text: '', x: 0, y: 0, width: 240, height: 120 },
      { id: 'image', type: 'file', file: 'sample-image.png', x: 0, y: 0, width: 240, height: 120 },
    ],
    edges: [],
  })
  Object.defineProperties(viewer.stage, {
    clientWidth: { value: 600 },
    clientHeight: { value: 400 },
  })
  const context = vi
    .spyOn(viewer.canvas, 'getContext')
    .mockReturnValue({ setTransform: vi.fn() } as never)
  const paint = vi.spyOn(painter, 'paintCanvas').mockReturnValue({ visible: [], warnings: [] })
  try {
    ;(viewer as unknown as { paint(): void }).paint()
    await Promise.resolve()
    const frames = [...el.querySelectorAll<HTMLElement>('.abele-canvas-card-frame')]
    expect(frames.map((frame) => frame.dataset.cardId)).toEqual(['alpha', 'beta', 'image'])
    expect(frames[0].querySelector('[data-node-id="alpha"]')?.textContent).toBe('Lower sample text')
    for (const frame of frames) expect(frame.firstElementChild?.tagName).toBe('CANVAS')
    expect(frames[1].querySelector('[data-node-id="beta"]')?.parentElement).toBe(frames[1])
    expect(paint.mock.calls[0][4]?.skipCards).toBe(true)
    const changed = { ...viewer.graph, nodes: [...viewer.graph.nodes].reverse() }
    viewer.load(changed)
    ;(viewer as unknown as { paint(): void }).paint()
    expect(
      [...el.querySelectorAll<HTMLElement>('.abele-canvas-card-frame')].map(
        (frame) => frame.dataset.cardId
      )
    ).toEqual(['image', 'beta', 'alpha'])
  } finally {
    viewer.destroy()
    el.remove()
    paint.mockRestore()
    context.mockRestore()
  }
})
