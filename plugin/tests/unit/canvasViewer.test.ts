import { describe, expect, it, vi } from 'vitest'
import { CanvasViewer } from '@/canvas/Viewer'
import { parseCanvas } from '@/canvas/core/model'
import * as painter from '@/canvas/core/painter'

const graph = () =>
  parseCanvas({
    nodes: [
      { id: 'alpha', type: 'text', text: 'Alpha', x: 0, y: 0, width: 200, height: 100 },
      { id: 'beta', type: 'file', file: 'sample-note.md', x: 400, y: 0, width: 200, height: 100 },
    ],
    edges: [],
    abele: {
      steps: [
        { id: 'start', reveal: ['alpha'], focus: 'alpha', say: 'First explanation' },
        { id: 'next', reveal: ['beta'], focus: 'beta', say: 'Second explanation' },
      ],
    },
  })
const theme = {
  paper: 'white',
  card: 'white',
  text: 'black',
  border: 'gray',
  accent: 'blue',
  muted: 'gray',
  font: 'sans-serif',
  size: 16,
  lineHeight: 1.4,
  presets: [],
}
const make = () => {
  const el = document.createElement('div')
  document.body.append(el)
  const sync = vi.fn(),
    dispose = vi.fn()
  const viewer = new CanvasViewer(el, {
    theme: () => theme,
    assets: async () => ({}),
    cards: { sync, destroy: dispose },
    openNode: vi.fn(),
  })
  return { viewer, el, sync, dispose }
}
describe('canvas viewer controls and lifetime', () => {
  it('does not paint a second image beneath a live markdown note card', () => {
    const { viewer, el, sync } = make()
    viewer.load(graph())
    Object.defineProperties(viewer.stage, {
      clientWidth: { value: 600 },
      clientHeight: { value: 400 },
    })
    sync.mockReturnValue(new Set(['beta']))
    const image = { source: document.createElement('img'), width: 100, height: 60 }
    const images = new Map([
      ['beta', [image]],
      ['alpha', [image]],
    ])
    ;(viewer as unknown as { assets: painter.CanvasAssets }).assets = {
      contents: new Map([['beta', 'Body before image']]),
      images,
    }
    const context = vi
      .spyOn(viewer.canvas, 'getContext')
      .mockReturnValue({ setTransform: vi.fn() } as never)
    const paint = vi.spyOn(painter, 'paintCanvas').mockReturnValue({ visible: [], warnings: [] })
    try {
      ;(viewer as unknown as { paint(): void }).paint()
      const assets = paint.mock.calls[0][4]!
      expect(assets.contents?.get('beta')).toBe('')
      expect(assets.images?.has('beta')).toBe(false)
      expect(assets.images?.get('alpha')).toEqual([image])
      expect(images.has('beta')).toBe(true)
    } finally {
      viewer.destroy()
      el.remove()
      paint.mockRestore()
      context.mockRestore()
    }
  })
  it('does not open a hidden file card inside a collapsed group, but opens it when expanded', () => {
    const { viewer, el } = make()
    const open = vi.spyOn((viewer as unknown as { ports: { openNode(): void } }).ports, 'openNode')
    const data = {
      nodes: [
        {
          id: 'frame',
          type: 'group' as const,
          label: 'Collapsed sample',
          collapsed: true,
          x: 0,
          y: 0,
          width: 300,
          height: 200,
        },
        {
          id: 'note',
          type: 'file' as const,
          file: 'sample-note.md',
          x: 30,
          y: 40,
          width: 200,
          height: 100,
        },
      ],
      edges: [],
    }
    const tap = () => {
      for (const type of ['pointerdown', 'pointerup'])
        viewer.stage.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            pointerType: 'touch',
            clientX: 80,
            clientY: 80,
            bubbles: true,
          })
        )
    }
    try {
      viewer.load(data)
      tap()
      expect(open).not.toHaveBeenCalled()
      viewer.load({ ...data, nodes: [{ ...data.nodes[0], collapsed: false }, data.nodes[1]] })
      tap()
      expect(open).toHaveBeenCalledOnce()
    } finally {
      viewer.destroy()
      el.remove()
    }
  })
  it('plays and rewinds with keys and taps; narration stays literal and navigation bounded', () => {
    const { viewer, el } = make()
    viewer.load(graph())
    viewer.go(1, false)
    expect(el.querySelector('.abele-canvas-narration')?.textContent).toBe('First explanation')
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(viewer.step).toBe(2)
    ;(el.querySelector('[aria-label="Previous step"]') as HTMLButtonElement).click()
    expect(viewer.step).toBe(1)
    const next = el.querySelector('[aria-label="Next step"]') as HTMLButtonElement
    next.click()
    next.click()
    expect(viewer.step).toBe(2)
    ;(el.querySelector('[aria-label="Show whole diagram"]') as HTMLButtonElement).click()
    expect(viewer.step).toBeNull()
    viewer.destroy()
    el.remove()
  })
  it('uses horizontal touch swipes for steps but not pinch, vertical pan or cancellation', () => {
    const { viewer, el } = make()
    viewer.load(graph())
    viewer.go(1, false)
    const pointer = (type: string, id: number, x: number, y: number) =>
      viewer.stage.dispatchEvent(
        new PointerEvent(type, {
          pointerId: id,
          pointerType: 'touch',
          clientX: x,
          clientY: y,
          bubbles: true,
        })
      )
    pointer('pointerdown', 1, 250, 150)
    pointer('pointermove', 1, 80, 150)
    pointer('pointerup', 1, 80, 150)
    expect(viewer.step).toBe(2)
    pointer('pointerdown', 2, 80, 150)
    pointer('pointermove', 2, 240, 150)
    pointer('pointercancel', 2, 240, 150)
    expect(viewer.step).toBe(2)
    pointer('pointerdown', 3, 250, 150)
    pointer('pointermove', 3, 250, 300)
    pointer('pointerup', 3, 250, 300)
    expect(viewer.step).toBe(2)
    pointer('pointerdown', 4, 80, 150)
    pointer('pointerdown', 5, 240, 150)
    pointer('pointermove', 4, 0, 150)
    pointer('pointerup', 4, 0, 150)
    pointer('pointerup', 5, 240, 150)
    expect(viewer.step).toBe(2)
    viewer.destroy()
    el.remove()
  })
  it('does not carry playback from a previous file when the adapter resets the view', () => {
    const { viewer, el } = make()
    viewer.load(graph())
    viewer.go(2, false)
    viewer.load(graph(), true)
    expect(viewer.step).toBeNull()
    expect(viewer.scene().graph.nodes).toHaveLength(2)
    viewer.destroy()
    el.remove()
  })
  it('keeps a stable step id across external reorder and releases rendering resources', () => {
    const { viewer, el, dispose } = make()
    viewer.load(graph())
    viewer.go(2, false)
    const changed = graph()
    ;(changed.abele!.steps as unknown[]).reverse()
    viewer.load(changed)
    expect(viewer.step).toBe(1)
    expect(viewer.scene().say).toBe('Second explanation')
    viewer.destroy()
    viewer.destroy()
    expect(dispose).toHaveBeenCalledOnce()
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(viewer.step).toBe(1)
    el.remove()
  })
  it('shows a parse/playback error without discarding the diagram or executing narration markup', () => {
    const { viewer, el } = make()
    const data = graph()
    ;(data.abele!.steps as { say: string }[])[0].say = '<img src=x onerror=alert(1)>'
    viewer.load(data)
    viewer.go(1, false)
    expect(el.querySelector('.abele-canvas-narration img')).toBeNull()
    expect(el.querySelector('.abele-canvas-narration')?.textContent).toContain('<img')
    data.abele!.steps = 'broken'
    viewer.load(data)
    expect(el.querySelector('.abele-canvas-status')?.textContent).toMatch(/steps/i)
    expect(viewer.scene().graph.nodes).toHaveLength(2)
    viewer.destroy()
    el.remove()
  })
})
