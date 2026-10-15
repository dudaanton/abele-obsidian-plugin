/**
 * Pictures added from the tool bar, a frame as small as it was drawn, and a carried frame taking
 * the strokes and lines drawn in it.
 */
import { describe, expect, it, vi } from 'vitest'
import type { CanvasGraph } from '@/canvas/core/model'
import { cards, pointer, setup } from '../helpers/canvasEditorHarness'

const mouse = { pointerType: 'mouse' }

describe('a picture from this device', () => {
  it(
    'is saved with the attachments and stands as a card in the middle of the view',
    { timeout: 15_000 },
    async () => {
      const s = setup(cards())
      Object.defineProperty(s.viewer.stage, 'clientWidth', { value: 1000 })
      Object.defineProperty(s.viewer.stage, 'clientHeight', { value: 800 })
      s.viewer.setCamera({ x: 2000, y: 2000, zoom: 1 })
      const saved: string[] = []
      ;(s.editor as unknown as { ports: Record<string, unknown> }).ports.saveAttachment = vi.fn(
        async (name: string) => (saved.push(name), `Attachments/${name}`)
      )
      const notice = (s.editor as unknown as { ports: { notice: ReturnType<typeof vi.fn> } }).ports
        .notice
      s.button('Add a picture').click()
      const input = s.el.querySelector<HTMLInputElement>('.abele-canvas-picture-input')!
      expect(input).not.toBeNull()
      expect(input.accept).toBe('image/*')
      expect(input.multiple).toBe(true)
      const files = [
        new File([new Uint8Array([1, 2, 3])], 'sample-one.png', { type: 'image/png' }),
        new File([new Uint8Array([4, 5])], 'sample-two.jpg', { type: 'image/jpeg' }),
      ]
      Object.defineProperty(input, 'files', { value: files })
      input.dispatchEvent(new Event('change'))
      await new Promise((r) => setTimeout(r, 50))
      expect(notice.mock.calls).toEqual([])
      // jsdom loads no picture: each waits out its size before standing at a default one.
      await vi.waitFor(() => expect(s.document.session.graph.nodes).toHaveLength(5), {
        timeout: 10_000,
      })
      expect(saved).toEqual(['sample-one.png', 'sample-two.jpg'])
      const added = s.document.session.graph.nodes.filter((n) => n.type === 'file')
      expect(added.map((n) => n.file)).toEqual([
        'Attachments/sample-one.png',
        'Attachments/sample-two.jpg',
      ])
      // Around the middle of what is shown, not where the canvas began.
      for (const n of added) expect(n.x).toBeGreaterThan(2000)
      expect(s.document.session.history.undo).toBe(1)
      // The field is gone once used.
      expect(s.el.querySelector('.abele-canvas-picture-input')).toBeNull()
    }
  )
})

describe('a frame drawn small', () => {
  it('keeps the size it was drawn, no smaller than a sliver that can be picked', async () => {
    const s = setup(cards())
    s.viewer.setCamera({ x: 0, y: 400, zoom: 1 })
    const c = s.editor.controls
    c.useTool('frame')
    pointer(s, 'pointerdown', 100, 100, { ...mouse, buttons: 1 })
    pointer(s, 'pointermove', 150, 120, { ...mouse, buttons: 1 })
    pointer(s, 'pointerup', 170, 125, mouse)
    await vi.waitFor(() =>
      expect(s.document.session.graph.nodes.some((n) => n.type === 'group')).toBe(true)
    )
    const frame = s.document.session.graph.nodes.find((n) => n.type === 'group')!
    expect(frame).toMatchObject({ width: 70, height: 40 })
  })
})

describe('a frame carried', () => {
  const framed = (): CanvasGraph => ({
    nodes: [{ id: 'bed', type: 'group', label: 'Bed', x: 0, y: 0, width: 400, height: 300 }],
    edges: [],
    abele: {
      ink: [
        {
          version: 1,
          id: 'inside',
          tool: 'pen',
          color: '',
          size: 2,
          points: [50, 50, 0.5, 120, 80, 0.5],
        },
        {
          version: 1,
          id: 'outside',
          tool: 'pen',
          color: '',
          size: 2,
          points: [600, 50, 0.5, 700, 80, 0.5],
        },
      ],
      lines: [
        {
          version: 1,
          id: 'arrow',
          from: { x: 60, y: 200 },
          to: { x: 300, y: 220 },
          toEnd: 'arrow',
        },
      ],
    },
  })
  it('takes the strokes and lines drawn inside it, and leaves the rest', async () => {
    const s = setup(framed())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    // Pressed on its empty room and carried.
    pointer(s, 'pointerdown', 350, 30, { ...mouse, buttons: 1 })
    pointer(s, 'pointermove', 400, 80, { ...mouse, buttons: 1 })
    pointer(s, 'pointerup', 450, 130, mouse)
    await vi.waitFor(() => expect(s.document.session.graph.nodes[0].x).toBe(100))
    const ink = s.document.session.graph.abele!.ink as {
      id: string
      transform?: { x: number; y: number }
    }[]
    // A stroke is carried by its transform, its drawn points kept as they were.
    expect(ink.find((e) => e.id === 'inside')!.transform).toMatchObject({ x: 100, y: 100 })
    expect(ink.find((e) => e.id === 'outside')!.transform).toBeUndefined()
    const line = (s.document.session.graph.abele!.lines as { from: { x: number } }[])[0]
    expect(line.from.x).toBe(160)
    expect(s.document.session.history.undo).toBe(1)
  })
})
