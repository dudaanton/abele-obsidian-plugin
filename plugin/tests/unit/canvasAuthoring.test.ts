import { expect, it } from 'vitest'
import { editCanvas } from '@/canvas/core/edit'
import { planCanvasEdit } from '@/canvas/core/service'
import { paintedRoute, paintedRouteHits, labelPoint } from '@/canvas/core/scene'
import { readFileSync } from 'node:fs'
const graph = () => ({
  nodes: [
    { id: 'a', type: 'text' as const, text: 'Sample', x: 0, y: 10, width: 100, height: 80 },
    { id: 'b', type: 'text' as const, text: 'Other', x: 200, y: 90, width: 60, height: 40 },
  ],
  edges: [],
})
it('retains measured dimensions when the same batch also needs automatic layout', () => {
  const result = planCanvasEdit(
    { nodes: [], edges: [] },
    [
      { op: 'add_node', node: { id: 'sample', kind: 'text', label: 'Sample words '.repeat(100) } },
      { op: 'fit', ids: ['sample'] },
    ],
    undefined,
    (node) => ({ width: node.width, height: 35 })
  )
  expect(result.nodes[0].height).toBe(35)
})
it('puts an automatic bend caption on the middle of the actual line', () => {
  expect(labelPoint({ kind: 'polyline', points: [] }, { x: 12, y: 34 })).toEqual({ x: 12, y: 34 })
  expect(
    labelPoint({
      kind: 'polyline',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 20 },
      ],
    })
  ).toEqual({ x: 60, y: 0 })
})
it('aligns selected cards atomically', () => {
  const source = graph()
  const result = editCanvas(source, [{ op: 'align', ids: ['a', 'b'], axis: 'top' }]).graph
  expect(result.nodes[1].y).toBe(10)
  expect(source.nodes[1].y).toBe(90)
})
it('matches the first card dimensions and refuses groups', () => {
  expect(
    editCanvas(graph(), [{ op: 'same_size', ids: ['a', 'b'], dimension: 'both' }]).graph.nodes[1]
  ).toMatchObject({ width: 100, height: 80 })
  const source = graph()
  expect(() =>
    editCanvas(source, [{ op: 'same_size', ids: ['a', 'missing'], dimension: 'width' }])
  ).toThrow('Unknown id')
  expect(source.nodes[1].width).toBe(60)
})
it('distributes by position with equal gaps and rejects duplicate selections', () => {
  const source = graph()
  source.nodes.push({ ...source.nodes[0], id: 'c', x: 400, width: 80 })
  const result = editCanvas(source, [
    { op: 'distribute', ids: ['c', 'a', 'b'], axis: 'horizontal' },
  ]).graph
  expect(result.nodes[1].x - 100).toBe(400 - result.nodes[1].x - 60)
  expect(() =>
    editCanvas(source, [{ op: 'distribute', ids: ['a', 'b', 'b'], axis: 'horizontal' }])
  ).toThrow('Duplicate')
})
it('fits with a renderer port, shrinks empty space, and never partially writes', () => {
  const source = graph()
  const result = editCanvas(source, [{ op: 'fit', ids: ['a', 'b'], width: 180 }], (node) => ({
    width: node.width,
    height: 35,
  })).graph
  expect(result.nodes.map((n) => [n.width, n.height])).toEqual([
    [180, 35],
    [180, 35],
  ])
  expect(() =>
    editCanvas(source, [{ op: 'fit', ids: ['a', 'b'] }], (node) => {
      if (node.id === 'b') throw new Error('Renderer failed')
      return { width: 100, height: 35 }
    })
  ).toThrow('Renderer failed')
  expect(source.nodes[0].height).toBe(80)
  expect(() => editCanvas(source, [{ op: 'fit', ids: ['a'] }])).toThrow('host rendered')
})
it('refuses unknown styling with supported alternatives and preserves retained fields', () => {
  const source = graph()
  expect(() =>
    editCanvas(source, [{ op: 'style', id: 'a', styleAttributes: { fontSiz: 12 } }])
  ).toThrow('Supported keys')
  expect(() =>
    editCanvas(source, [{ op: 'update', id: 'a', patch: { styleAttributes: { padding: 3 } } }])
  ).toThrow('Supported keys')
  const extended = {
    ...source,
    nodes: source.nodes.map((n) => ({ ...n, styleAttributes: { future: 'kept' } })),
  }
  expect(
    editCanvas(extended, [{ op: 'style', id: 'a', styleAttributes: { border: 'dashed' } }]).graph
      .nodes[0].styleAttributes
  ).toEqual({ future: 'kept', border: 'dashed' })
})
it('renders explicit bends, anchors and obstacle routes without dropping extension data', () => {
  const source = { ...graph(), edges: [{ id: 'e', fromNode: 'a', toNode: 'b', future: 'kept' }] }
  const result = editCanvas(source, [
    {
      op: 'route',
      id: 'e',
      fromSide: 'bottom',
      waypoints: [{ x: 120, y: 150 }],
      labelPosition: { x: 130, y: 155 },
    },
  ]).graph
  expect(paintedRoute(result.edges[0], result)).toMatchObject({
    kind: 'polyline',
    points: [{ x: 50, y: 90 }, { x: 120, y: 150 }, expect.anything()],
  })
  expect(result.edges[0]).toMatchObject({
    future: 'kept',
    abele: { labelPosition: { x: 130, y: 155 } },
  })
  expect(() => editCanvas(source, [{ op: 'route', id: 'missing' }])).toThrow('Unknown edge')
  const obstacle = { ...source.nodes[0], id: 'obstacle', x: 130, y: 0, width: 40, height: 200 }
  source.nodes.push(obstacle)
  const avoided = editCanvas(source, [
    { op: 'route', id: 'e', fromSide: 'right', toSide: 'left', method: 'avoid' },
  ]).graph
  expect(paintedRouteHits(paintedRoute(avoided.edges[0], avoided), obstacle)).toBe(false)
})
it('documents the precise operations and measurement and batch crop inputs', () => {
  const docs = readFileSync('src/docs/tools.md', 'utf8')
  for (const word of [
    'fit {ids,width?}',
    'align {ids,axis}',
    'same_size {ids,dimension}',
    'distribute {ids,axis,gap?}',
    'route {id,fromSide?',
    'measure: ids[]',
    'regions: [{node:id}',
  ])
    expect(docs).toContain(word)
})
