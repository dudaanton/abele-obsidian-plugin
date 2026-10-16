import { expect, it, vi } from 'vitest'
import { CanvasInkInput } from '@/canvas/inkAdapter'
import type { CanvasViewer } from '@/canvas/Viewer'
import type { InputPorts } from '@/canvas/input'

it('shares bounded input with canvas pencil, including coalesced samples and pen-up pressure', () => {
  const complete = vi.fn()
  const el = document.createElement('div')
  const viewer = {
    el,
    stage: el,
    camera: { x: 0, y: 0, zoom: 4 },
    graph: { nodes: [], edges: [] },
    drawInk() {},
  } as unknown as CanvasViewer
  const ports = {
    tool: () => 'pen',
    brush: () => ({ color: '1', size: 2 }),
    select() {},
    begin: () => true,
    valid: () => true,
    complete,
  } as unknown as InputPorts
  const input = new CanvasInkInput(viewer, ports)
  const event = (x: number, y: number, pressure: number): PointerEvent =>
    ({
      pointerId: 1,
      pointerType: 'pen',
      button: 0,
      buttons: 1,
      clientX: x,
      clientY: y,
      pressure,
    }) as PointerEvent
  try {
    expect(input.down(event(0, 0, 0.2))).toBe(true)
    input.move({
      ...event(2, 0, 0.8),
      getCoalescedEvents: () => [event(1, 0.4, 1), event(2, 0, 0.8)],
    })
    input.up(event(3, 0, 0))
    const stroke = complete.mock.calls[0][0][0].stroke
    expect(stroke.linear).toBe(true)
    expect(stroke.points).toHaveLength(12)
    expect(stroke.points.slice(0, 3)).toEqual([0, 0, 0.2])
    expect(stroke.points.slice(-3)).toEqual([0.75, 0, 0.8])
    expect(stroke.points[4]).toBeCloseTo(0.075)
    expect(stroke.points.filter((_: number, i: number) => i % 3 === 2)).toEqual([0.2, 1, 0.8, 0.8])
  } finally {
    input.cancel()
  }
})
