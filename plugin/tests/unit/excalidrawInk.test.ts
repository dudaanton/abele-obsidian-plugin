import { describe, expect, it } from 'vitest'
import { convertExcalidraw } from '@/canvas/excalidraw/convert'
import { parseExcalidraw } from '@/canvas/excalidraw/source'
import { inkOf } from '@/canvas/core/ink'

describe('migrated freehand geometry', () => {
  it('simulates lighter pressure on fast segments instead of a constant', () => {
    const scene = parseExcalidraw(
      JSON.stringify({
        elements: [
          {
            id: 'sample-speed',
            type: 'freedraw',
            x: 0,
            y: 0,
            width: 100,
            height: 1,
            strokeWidth: 2,
            simulatePressure: true,
            points: [
              [0, 0],
              [0.2, 0],
              [0.4, 0],
              [20, 0],
              [40, 0],
              [60, 0],
            ],
          },
        ],
      }),
      'sample.excalidraw'
    )
    const stroke = inkOf(
      convertExcalidraw(scene, { source: 'sample.excalidraw', resolve: () => null }).graph
    )[0]
    expect(stroke.points[17]).toBeLessThan(stroke.points[8])
  })
  for (const width of [1, 2, 4]) {
    for (const simulated of [false, true]) {
      it(`keeps dense samples and width ${width}, simulated=${simulated}`, () => {
        const points = Array.from({ length: 240 }, (_, i) => [i * 0.037, Math.sin(i / 80) * 3.013])
        const pressures = points.map((_, i) => 0.2 + (i / 239) * 0.6)
        const scene = parseExcalidraw(
          JSON.stringify({
            type: 'excalidraw',
            elements: [
              {
                id: 'sample-curve',
                type: 'freedraw',
                x: 10.013,
                y: 20.027,
                width: 10,
                height: 4,
                points,
                pressures,
                strokeWidth: width,
                simulatePressure: simulated,
              },
            ],
          }),
          'sample.excalidraw'
        )
        const stroke = inkOf(
          convertExcalidraw(scene, { source: 'sample.excalidraw', resolve: () => null }).graph
        )[0]
        expect(stroke.size).toBe(width * 4.25 * Math.SQRT2)
        points.forEach(([x, y], i) => {
          expect(stroke.points[i * 3]).toBe(x + 10.013)
          expect(stroke.points[i * 3 + 1]).toBe(y + 20.027)
          if (!simulated) expect(stroke.points[i * 3 + 2]).toBe(pressures[i])
        })
      })
    }
  }
})
