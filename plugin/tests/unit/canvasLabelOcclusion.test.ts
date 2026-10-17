import { expect, it } from 'vitest'
import { lintCanvas } from '@/canvas/core/lint'
import { canvasOutline } from '@/canvas/core/read'
import { editCanvas } from '@/canvas/core/edit'
import { defaultMetrics } from '@/canvas/core/scene'
import { lineBounds, linesOf } from '@/canvas/core/primitives'
import type { CanvasGraph } from '@/canvas/core/model'
const graph = (): CanvasGraph => ({
  nodes: [
    { id: 'a', type: 'text', text: '', x: 0, y: 0, width: 100, height: 100 },
    { id: 'b', type: 'text', text: '', x: 400, y: 0, width: 100, height: 100 },
    { id: 'cover', type: 'text', text: '', x: 240, y: 35, width: 20, height: 20 },
  ],
  edges: [
    {
      id: 'edge',
      fromNode: 'a',
      toNode: 'b',
      fromSide: 'right',
      toSide: 'left',
      label: 'Caption',
      pathfindingMethod: 'direct',
    },
  ],
  abele: {
    lines: [
      { version: 1, id: 'line', from: { x: 100, y: 50 }, to: { x: 400, y: 50 }, label: 'Caption' },
    ],
  },
})
it('uses supplied font metrics and detects label pairs without treating groups as occluders', () => {
  const g = graph()
  g.nodes.push({ id: 'group', type: 'group', x: 0, y: 0, width: 600, height: 200 })
  const metrics = { ...defaultMetrics, size: 20, measure: () => 100 }
  const result = canvasOutline(g, { detail: 'full' }, metrics)
  expect(result.edges[0]).toHaveProperty('labelBox', { x: 196, y: 30, width: 108, height: 28 })
  expect(result.lines[0]).toHaveProperty('labelBox', { x: 196, y: 30, width: 108, height: 28 })
  expect(result.warnings).toContainEqual(
    expect.objectContaining({ code: 'overlapping-edge-labels', ids: ['edge', 'line'] })
  )
  expect(
    result.warnings
      .filter((w) => w.code === 'covered-edge-label')
      .some((w) => w.ids.includes('group'))
  ).toBe(false)
})
it('keeps explicitly placed free captions in bounds and moves them with their line', () => {
  let g = editCanvas(graph(), [
    { op: 'update', id: 'line', patch: { labelPosition: { x: 800, y: 200 } } },
  ]).graph
  expect(lineBounds(linesOf(g)[0]).x + lineBounds(linesOf(g)[0]).width).toBeGreaterThan(800)
  g = editCanvas(g, [{ op: 'move', ids: ['line'], dx: 20, dy: 30 }]).graph
  expect(linesOf(g)[0].labelPosition).toEqual({ x: 820, y: 230 })
})
it('reports covered edge and line captions including endpoint cards', () => {
  const g = graph()
  expect(
    lintCanvas(g)
      .filter((w) => w.code === 'covered-edge-label')
      .map((w) => w.ids)
  ).toEqual([
    ['edge', 'cover'],
    ['line', 'cover'],
  ])
  g.edges[0].abele = { labelPosition: { x: 50, y: 50 } }
  expect(lintCanvas(g)).toContainEqual(
    expect.objectContaining({ code: 'covered-edge-label', ids: ['edge', 'a'] })
  )
})
it('exposes caption bounds and resolves occlusion in one edit', () => {
  expect(canvasOutline(graph(), { detail: 'full' }).edges[0]).toHaveProperty('labelBox')
  expect(canvasOutline(graph(), { detail: 'full' }).lines[0]).toHaveProperty('labelBox')
  const moved = editCanvas(graph(), [
    { op: 'route', id: 'edge', labelPosition: { x: 180, y: 50 } },
    { op: 'update', id: 'line', patch: { labelPosition: { x: 180, y: 50 } } },
  ]).graph
  expect(lintCanvas(moved).filter((w) => w.code === 'covered-edge-label')).toEqual([])
})
