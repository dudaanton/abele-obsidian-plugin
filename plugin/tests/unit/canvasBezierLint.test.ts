import { describe, expect, it } from 'vitest'
import { lintCanvas } from '@/canvas/core/lint'
import type { CanvasGraph } from '@/canvas/core/model'
function sample(x: number, y: number, method = 'bezier'): CanvasGraph {
  return {
    nodes: [
      { id: 'sample-a', type: 'text', text: 'A', x: 0, y: 0, width: 260, height: 160 },
      { id: 'sample-b', type: 'text', text: 'B', x: 500, y: 400, width: 260, height: 160 },
      { id: 'sample-obstacle', type: 'text', text: '', x, y, width: 10, height: 10 },
    ],
    edges: [
      { id: 'sample-flow', fromNode: 'sample-a', toNode: 'sample-b', pathfindingMethod: method },
    ],
  }
}
const crossing = (graph: CanvasGraph) =>
  lintCanvas(graph)
    .filter((w) => w.code === 'edge-crossing')
    .map((w) => w.ids)
describe('shared painted route collision geometry', () => {
  it('detects the cubic at (331.25,142.5), not just its control polygon', () => {
    expect(crossing(sample(326, 138))).toContainEqual(['sample-flow', 'sample-obstacle'])
  })
  it('does not report the control polygon as a painted cubic', () => {
    expect(crossing(sample(376, 138))).not.toContainEqual(['sample-flow', 'sample-obstacle'])
    expect(crossing(sample(376, 138, 'square'))).toContainEqual(['sample-flow', 'sample-obstacle'])
  })
  it('uses the actual direct path rather than the cubic when direct is selected', () => {
    expect(crossing(sample(326, 138, 'direct'))).not.toContainEqual([
      'sample-flow',
      'sample-obstacle',
    ])
  })
})
