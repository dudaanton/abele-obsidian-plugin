import { describe, expect, it, vi } from 'vitest'
import { CanvasInkEditInput } from '@/canvas/inkEditAdapter'
import { inkEntries, lassoInk, type CanvasInk } from '@/canvas/core/ink'
import type { CanvasGraph } from '@/canvas/core/model'
import { CanvasViewer } from '@/canvas/Viewer'
import type { InputPorts } from '@/canvas/input'

function scene(): CanvasGraph {
  const graph: CanvasGraph = {
    nodes: Array.from({ length: 300 }, (_, i) => ({
      id: `sample-card-${i}`,
      type: 'text',
      text: 'Sample content '.repeat(150),
      x: (i % 20) * 250,
      y: Math.floor(i / 20) * 150,
      width: 200,
      height: 100,
    })),
    edges: [],
    abele: {
      ink: Array.from({ length: 3 }, (_, i) => ({
        version: 1,
        id: `sample-ink-${i}`,
        tool: 'pen',
        color: '1',
        size: 3,
        freedraw: { simulatePressure: false, streamline: 0.5 },
        points: Array.from({ length: 100 }, (_, j) => [
          j * 2,
          5000 + i * 100 + Math.sin(j / 5) * 10,
          0.5,
        ]).flat(),
      })),
    },
  }
  const attached = (graph.abele.ink as CanvasInk[]).pop()
  graph.nodes[0].abele = { ink: [{ ...attached, frame: { width: 200, height: 100 } }] }
  return graph
}
const event = (x: number, y: number) =>
  ({
    pointerId: 1,
    pointerType: 'mouse',
    clientX: x,
    clientY: y,
  }) as PointerEvent

describe('ink gesture cost on a card-heavy canvas', () => {
  it.each(['eraser', 'partial-eraser', 'lasso'] as const)(
    '%s avoids processing card payloads per sample',
    (tool) => {
      const graph = scene(),
        original = JSON.stringify(graph)
      let queued: FrameRequestCallback | undefined,
        renders = 0
      const viewer = {
        graph,
        camera: { x: 0, y: 0, zoom: 1 },
        stage: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
        el: {
          ownerDocument: {
            defaultView: {
              requestAnimationFrame: (callback: FrameRequestCallback) => {
                queued = callback
                return 1
              },
            },
          },
        },
        paintInk: () => {
          renders++
        },
        drawInk: CanvasViewer.prototype.drawInk,
        draw: vi.fn(),
      }
      const ports = {
        tool: () => tool,
        selection: () => new Set<string>(),
        multiple: () => false,
        begin: vi.fn(() => true),
        valid: () => true,
        complete: vi.fn(),
        cancel: vi.fn(),
        select: vi.fn(),
        invalid: vi.fn(),
      }
      const input = new CanvasInkEditInput(
        viewer as unknown as CanvasViewer,
        ports as unknown as InputPorts
      )
      input.down(event(0, 5000))
      const stringify = vi.spyOn(JSON, 'stringify')
      const times: number[] = []
      try {
        for (let i = 0; i < 120; i++) {
          const start = performance.now()
          input.move({
            ...event(i * 2, 5000),
            getCoalescedEvents: () => [event(i * 2 - 1, 5000)],
          } as PointerEvent)
          times.push(performance.now() - start)
          if (i % 4 === 3 && queued) {
            const frame = queued
            queued = undefined
            frame(0)
          }
        }
        const max = Math.max(...times),
          total = times.reduce((a, b) => a + b, 0)
        console.info(
          `${tool}: 300 cards, 120 moves/240 samples, ${total.toFixed(2)}ms total, ${max.toFixed(2)}ms max, ${renders} ink frames, ${stringify.mock.calls.length} serializations`
        )
        expect(stringify).not.toHaveBeenCalled()
        expect(max).toBeLessThan(50)
        expect(total / times.length).toBeLessThan(8)
        expect(renders).toBe(30)
        expect(viewer.draw).not.toHaveBeenCalled()
        expect(viewer.graph.nodes[0].text).toBe(graph.nodes[0].text)
        expect(inkEntries(viewer.graph).at(-1)?.stroke).toBe(inkEntries(graph).at(-1)?.stroke)
      } finally {
        stringify.mockRestore()
      }
      expect(JSON.stringify(graph)).toBe(original)
      input.up(event(240, 5000))
      expect(ports.complete.mock.calls.length).toBe(tool === 'lasso' ? 0 : 1)
      expect(viewer.draw).toHaveBeenCalledTimes(1)
      if (tool !== 'lasso') {
        viewer.graph = graph
        input.down(event(20, 5200))
        input.move(event(50, 5200))
        expect(
          inkEntries(viewer.graph).find((e) => e.stroke.id === 'sample-ink-2')?.stroke
        ).not.toBe(inkEntries(graph).at(-1)?.stroke)
        input.cancel()
        expect(ports.cancel).toHaveBeenCalledTimes(1)
        expect(ports.complete).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(graph)).toBe(original)
      }
      if (tool === 'lasso') {
        const start = performance.now()
        expect(lassoInk(graph, [-20, 4980, 250, 4980, 250, 5030, -20, 5030])).toEqual([
          'sample-ink-0',
        ])
        console.info(`lasso final selection: ${(performance.now() - start).toFixed(2)}ms`)
      }
    }
  )
})
