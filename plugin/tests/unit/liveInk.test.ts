import { afterEach, describe, expect, it, vi } from 'vitest'
import { strokeGesture } from '@/drawing/tools'
import { DrawingItems } from '@/drawing/history'
import { drawingSvg, parseDrawingSvg } from '@/drawing/drawingFile'
import { inkSvg, parseInkSvg } from '@/reader/ink/inkFile'
import { InkOverlay } from '@/reader/ink/inkOverlay'
import { hitStroke, strokePath, type InkStroke } from '@/ink/stroke'
import { inkPath, inkSchema } from '@/canvas/core/ink'
import { CanvasInkInput } from '@/canvas/inkAdapter'
import type { CanvasViewer } from '@/canvas/Viewer'
import type { InputPorts } from '@/canvas/input'

afterEach(() => vi.unstubAllGlobals())
const samples = Array.from({ length: 121 }, (_, i) => ({
  x: 10.013 + i * 0.37,
  y: 20.027 + Math.sin(i / 18) * 12,
  p: i === 0 || i === 120 ? 0 : 0.15 + 0.7 * Math.sin((i * Math.PI) / 120),
}))

describe('shared live freehand input and persistence', () => {
  for (const pointerType of ['pen', 'mouse', 'touch']) {
    it(`records canvas ${pointerType} pressure mode and full precision`, () => {
      const stage = document.createElement('div'),
        complete = vi.fn()
      const viewer = {
        stage,
        el: stage,
        camera: { x: 0, y: 0, zoom: 1 },
        graph: { nodes: [], edges: [] },
        drawInk: vi.fn(),
      } as unknown as CanvasViewer
      const input = new CanvasInkInput(viewer, {
        tool: () => 'pen',
        brush: () => ({ size: 4, color: '' }),
        select: vi.fn(),
        begin: () => true,
        valid: () => true,
        complete,
      } as unknown as InputPorts)
      input.down(
        new PointerEvent('pointerdown', {
          pointerType,
          pointerId: 1,
          clientX: 10.013,
          clientY: 20.027,
          pressure: 0.2,
          buttons: 1,
        })
      )
      input.up(
        new PointerEvent('pointerup', {
          pointerType,
          pointerId: 1,
          clientX: 50.019,
          clientY: 21.037,
          pressure: 0,
          buttons: 0,
        })
      )
      const stroke = complete.mock.calls[0][0][0].stroke
      expect(stroke.freedraw).toEqual({
        simulatePressure: false,
        streamline: 0.5,
      })
      expect(stroke.points.slice(-3)).toEqual([50.019, 21.037, pointerType === 'pen' ? 0 : 0.5])
    })
  }
  for (const stylus of [true, false]) {
    it(`records source samples and pressure mode for ${stylus ? 'pen' : 'mouse/finger'}`, () => {
      const items = new DrawingItems()
      const gesture = strokeGesture(
        { items, zoom: () => 1, added: vi.fn(), repaint: vi.fn(), changed: vi.fn() },
        { tool: 'pen', color: 'black', size: 4 },
        samples[0],
        stylus
      )
      gesture.move(samples.slice(1), [{ x: 900, y: 900, p: 1 }])
      gesture.end(false)
      const stroke = items.items[0]
      expect(stroke).toMatchObject({
        linear: true,
        freedraw: { simulatePressure: false, streamline: 0.5 },
      })
      expect(stroke.type === 'stroke' && stroke.points).toEqual(
        samples.flatMap((p) => [p.x, p.y, p.p])
      )
      const svg = drawingSvg({ items: [stroke] })
      const loaded = parseDrawingSvg(svg)!.items[0]
      expect(loaded).toEqual(stroke)
      items.undo()
      expect(items.items).toHaveLength(0)
      items.redo()
      expect(items.items[0]).toEqual(stroke)
    })
  }

  for (const tool of ['pen', 'marker'] as const) {
    it(`keeps ${tool} outline and mode through reader, drawing and canvas storage`, () => {
      const stroke: InkStroke = {
        tool,
        color: 'black',
        size: 4,
        linear: true,
        freedraw: { simulatePressure: false, streamline: 0.5 },
        points: samples.flatMap((p) => [p.x, p.y, p.p]),
      }
      const svg = inkSvg({ width: 200, height: 200, strokes: [stroke] })
      const loaded = parseInkSvg(svg)!.strokes[0]
      expect(loaded).toEqual(stroke)
      expect(strokePath(loaded)).toBe(strokePath(stroke))
      const canvas = inkSchema.parse({ ...stroke, version: 1, id: 'sample', color: '' })
      expect(inkPath(canvas)).toBe(strokePath(stroke))
      expect(strokePath(stroke)).toMatch(/Z$/)
      if (tool === 'marker') expect(svg).not.toContain('fill="none"')
    })
  }

  it('picks the displayed low-pressure outline instead of a maximum-pressure envelope', () => {
    const stroke: InkStroke = {
      tool: 'pen',
      color: 'black',
      size: 10,
      freedraw: { simulatePressure: false, streamline: 0.5 },
      points: [0, 0, 0, 50, 0, 0, 100, 0, 0],
    }
    expect(hitStroke(stroke, 50, 0, 0)).toBe(true)
    expect(hitStroke(stroke, 50, 6, 0)).toBe(false)
    expect(hitStroke(stroke, 50, 6, 5)).toBe(true)
  })

  for (const pointerType of ['pen', 'mouse', 'touch']) {
    it(`records reader ${pointerType} mode and terminal sample without predicted ink`, () => {
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          disconnect() {}
        }
      )
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
      const commit = vi.fn()
      const rect = new DOMRect(0, 0, 200, 200)
      const overlay = new InkOverlay(document.body, {
        pageAt: () => ({ index: 0, rect, width: 200, height: 200 }),
        route: () => 'ink',
        brush: () => ({ tool: 'pen', color: 'black', size: 4 }),
        pen: vi.fn(),
        commit,
        eraseStart: vi.fn(),
        eraseAt: vi.fn(),
        eraseEnd: vi.fn(),
        pan: () => false,
        turn: vi.fn(),
        zoom: vi.fn(),
      })
      try {
        for (const [type, x, pressure] of [
          ['pointerdown', 10, 0.1],
          ['pointermove', 30, 0.8],
          ['pointerup', 40, 0],
        ] as const)
          overlay.el.dispatchEvent(
            new PointerEvent(type, {
              pointerType,
              pointerId: 1,
              clientX: x,
              clientY: 20,
              pressure,
              buttons: type === 'pointerup' ? 0 : 1,
            })
          )
        const stroke = commit.mock.calls[0][1] as InkStroke
        expect(stroke.freedraw).toEqual({
          simulatePressure: false,
          streamline: 0.5,
        })
        expect(stroke.points.slice(-3)).toEqual([40, 20, pointerType === 'pen' ? 0 : 0.5])
      } finally {
        overlay.destroy()
        vi.restoreAllMocks()
      }
    })
  }
})
