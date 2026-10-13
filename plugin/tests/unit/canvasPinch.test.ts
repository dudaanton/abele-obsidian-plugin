import { expect, it, vi } from 'vitest'
import { CanvasViewer } from '@/canvas/Viewer'

it('cancels a card edit when a second pointer arrives and zooms without committing that edit', () => {
  const el = document.createElement('div')
  document.body.append(el)
  const viewer = new CanvasViewer(el, {
    theme: () => ({
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
    }),
    assets: async () => ({}),
    cards: { sync: () => new Set(), destroy: () => {} },
    openNode: () => {},
  })
  const cancel = vi.fn(),
    move = vi.fn(),
    up = vi.fn()
  viewer.input = { down: () => true, move, up, cancel, paint: () => {} }
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
  try {
    pointer('pointerdown', 1, 100, 100)
    pointer('pointermove', 1, 110, 110)
    expect(move).toHaveBeenCalledOnce()
    const zoom = viewer.camera.zoom
    pointer('pointerdown', 2, 200, 100)
    expect(cancel).toHaveBeenCalledOnce()
    pointer('pointermove', 1, 60, 110)
    pointer('pointermove', 2, 250, 100)
    expect(viewer.camera.zoom).toBeGreaterThan(zoom)
    pointer('pointerup', 1, 60, 110)
    pointer('pointerup', 2, 250, 100)
    expect(up).not.toHaveBeenCalled()
    expect(move).toHaveBeenCalledOnce()
  } finally {
    viewer.destroy()
    el.remove()
  }
})
