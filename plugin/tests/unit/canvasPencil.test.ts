import { describe, expect, it, vi } from 'vitest'
import { linesOf } from '@/canvas/core/primitives'
import type { CanvasGraph } from '@/canvas/core/model'
import type { CanvasInputTool } from '@/canvas/input'
import { pointer, setup } from '../helpers/canvasEditorHarness'

/** One stroke already on the canvas, under the pen's path, for the erasers to find. */
const drawn = (): CanvasGraph => ({
  nodes: [],
  edges: [],
  abele: {
    ink: [
      {
        version: 1,
        id: 'sample-stroke',
        tool: 'pen',
        color: '1',
        size: 2,
        points: [100, 380, 0.5, 100, 460, 0.5],
      },
    ],
  },
})
const pen = { pointerType: 'pen', pressure: 0.6, pointerId: 5 }
const stroke = (s: ReturnType<typeof setup>) => {
  pointer(s, 'pointerdown', 40, 400, { ...pen, buttons: 1 })
  pointer(s, 'pointermove', 100, 410, { ...pen, buttons: 1 })
  pointer(s, 'pointermove', 200, 440, { ...pen, buttons: 1 })
  pointer(s, 'pointerup', 200, 440, pen)
}
const ink = (s: ReturnType<typeof setup>) =>
  (s.document.session.graph.abele?.ink as { id: string; tool: string }[] | undefined) ?? []

describe('a Pencil does what the tool in hand does', () => {
  const cases: [CanvasInputTool, (s: ReturnType<typeof setup>) => Promise<void> | void][] = [
    ['pen', async (s) => await vi.waitFor(() => expect(ink(s).at(-1)?.tool).toBe('pen'))],
    ['marker', async (s) => await vi.waitFor(() => expect(ink(s).at(-1)?.tool).toBe('marker'))],
    [
      'select',
      (s) => {
        expect(s.document.session.graph.nodes).toEqual([])
        expect(s.viewer.camera).toMatchObject({ x: 0, y: 0 })
      },
    ],
    ['pan', (s) => expect(s.viewer.camera).toMatchObject({ x: -160, y: -40 })],
    [
      'card',
      async (s) =>
        await vi.waitFor(() =>
          expect(s.document.session.graph.nodes.map((n) => n.type)).toEqual(['text'])
        ),
    ],
    [
      'shape',
      async (s) => await vi.waitFor(() => expect(s.document.session.graph.nodes).toHaveLength(1)),
    ],
    [
      'frame',
      async (s) =>
        await vi.waitFor(() =>
          expect(s.document.session.graph.nodes.map((n) => n.type)).toEqual(['group'])
        ),
    ],
    [
      'line',
      async (s) =>
        await vi.waitFor(() => expect(linesOf(s.document.session.graph)).toHaveLength(1)),
    ],
    [
      'arrow',
      async (s) =>
        await vi.waitFor(() => expect(linesOf(s.document.session.graph)).toHaveLength(1)),
    ],
    ['eraser', async (s) => await vi.waitFor(() => expect(ink(s)).toEqual([]))],
    [
      'partial-eraser',
      async (s) =>
        await vi.waitFor(() => expect(ink(s).map((i) => i.id)).not.toEqual(['sample-stroke'])),
    ],
    ['lasso', () => {}],
    ['connect', () => {}],
  ]
  for (const [tool, effect] of cases)
    it(`with ${tool} in hand`, async () => {
      const s = setup(drawn())
      s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
      s.editor.controls.useTool(tool)
      stroke(s)
      await effect(s)
      // Only the drawing tools leave ink of their own, and only the erasers take any away.
      if (tool !== 'pen' && tool !== 'marker' && !tool.includes('eraser'))
        expect(ink(s).map((i) => i.id)).toEqual(['sample-stroke'])
      expect(s.editor.controls.pencil()).toBe(true)
    })
  it('still erases with its other end whatever is in hand', async () => {
    const s = setup(drawn())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    s.editor.controls.useTool('card')
    pointer(s, 'pointerdown', 40, 400, { ...pen, buttons: 32 })
    pointer(s, 'pointermove', 200, 440, { ...pen, buttons: 32 })
    pointer(s, 'pointerup', 200, 440, pen)
    await vi.waitFor(() => expect(ink(s)).toEqual([]))
    expect(s.document.session.graph.nodes).toEqual([])
  })
})

describe('a Pencil held over the screen', () => {
  /** The tip as the overlay paints it now; the stage here has no size, so it is asked to. */
  const ring = async (s: ReturnType<typeof setup>) => {
    s.viewer.input!.paint()
    return s.el.querySelector('.abele-canvas-pen-hover')
  }
  const hover = (s: ReturnType<typeof setup>, x = 120) =>
    pointer(s, 'pointermove', x, 200, { ...pen, buttons: 0, pressure: 0 })
  const drawing = () => {
    const s = setup()
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    s.editor.controls.useTool('pen')
    return s
  }
  it('shows the tip only while a pen or marker is in hand', async () => {
    const s = drawing()
    hover(s)
    expect(await ring(s)).not.toBeNull()
    s.editor.controls.useTool('select')
    expect(await ring(s)).toBeNull()
    hover(s, 130)
    expect(await ring(s)).toBeNull()
  })
  for (const type of ['pointerleave', 'pointerout', 'pointercancel'])
    it(`lets the tip go on ${type}`, async () => {
      const s = drawing()
      hover(s)
      expect(await ring(s)).not.toBeNull()
      pointer(s, type, 120, 200, { ...pen, buttons: 0 })
      expect(await ring(s)).toBeNull()
    })
  it('lets the tip go when the pen goes quiet, as a pen taken away may send nothing', async () => {
    const s = drawing()
    hover(s)
    await new Promise((resolve) => setTimeout(resolve, 600))
    hover(s, 125)
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(await ring(s)).not.toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(await ring(s)).toBeNull()
  })
})
