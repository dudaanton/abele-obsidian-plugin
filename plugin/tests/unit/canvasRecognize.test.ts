import { describe, expect, it } from 'vitest'
import { recognizeStroke } from '@/canvas/core/recognize'

const triples = (pts: [number, number][]) => pts.flatMap(([x, y]) => [x, y, 0.5])
const wobble = (i: number) => Math.sin(i * 1.7) * 1.5

describe('a stroke held still becomes a plain shape', () => {
  it('a nearly straight stroke is a line between its ends', () => {
    const pts = Array.from({ length: 30 }, (_, i) => [i * 10, 100 + wobble(i)] as [number, number])
    expect(recognizeStroke(triples(pts))).toMatchObject({ kind: 'line', from: { x: 0 }, to: { x: 290 } })
  })
  it('a loop drawn round is an ellipse in its box', () => {
    const pts = Array.from({ length: 60 }, (_, i) => {
      const a = (i / 59) * Math.PI * 2
      return [200 + Math.cos(a) * 100 + wobble(i), 150 + Math.sin(a) * 60 + wobble(i + 3)] as [number, number]
    })
    const shape = recognizeStroke(triples(pts))
    expect(shape?.kind).toBe('circle')
  })
  it('a loop drawn with corners is a rectangle', () => {
    const pts: [number, number][] = []
    for (let i = 0; i <= 20; i++) pts.push([i * 10, wobble(i)])
    for (let i = 0; i <= 10; i++) pts.push([200 + wobble(i), i * 10])
    for (let i = 20; i >= 0; i--) pts.push([i * 10, 100 + wobble(i)])
    for (let i = 10; i >= 0; i--) pts.push([wobble(i), i * 10])
    expect(recognizeStroke(triples(pts))).toMatchObject({ kind: 'rectangle', rect: { width: expect.any(Number) } })
  })
  it('a scribble or a tiny mark stays as drawn', () => {
    const zigzag = Array.from({ length: 20 }, (_, i) => [i * 10, i % 2 ? 0 : 60] as [number, number])
    expect(recognizeStroke(triples(zigzag))).toBeNull()
    expect(recognizeStroke(triples([[0, 0], [5, 3], [9, 1]]))).toBeNull()
  })
})
