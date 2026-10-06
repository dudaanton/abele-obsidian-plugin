import { describe, expect, it } from 'vitest'
import { editCanvas } from '@/canvas/core/edit'
import { parentsOf, type CanvasGraph } from '@/canvas/core/model'
import {
  hitNode,
  hitResize,
  moveIds,
  movePreview,
  nodesInBox,
  resizeRect,
  selectNode,
} from '@/canvas/core/selection'
import { toScreen, toWorld } from '@/drawing/camera'

const graph = (): CanvasGraph => ({
  nodes: [
    { id: 'frame', type: 'group', x: -40, y: -40, width: 400, height: 300, label: 'Group' },
    { id: 'inner', type: 'group', x: 0, y: 0, width: 280, height: 200, label: 'Inner' },
    {
      id: 'card',
      type: 'text',
      text: 'Card',
      x: 20,
      y: 20,
      width: 200,
      height: 100,
      extension: { kept: true },
    },
    { id: 'top', type: 'file', file: 'sample.md', x: 30, y: 30, width: 100, height: 60 },
  ],
  edges: [{ id: 'edge', fromNode: 'card', toNode: 'top', extension: 'kept' }],
  extension: { kept: true },
})

describe('canvas selection geometry', () => {
  it('picks native stacking including group backgrounds and excludes collapsed descendants', () => {
    const g = graph()
    expect(hitNode(g, 40, 40)?.id).toBe('top')
    expect(hitNode(g, 250, 190)?.id).toBe('inner')
    expect(hitNode(g, -20, -20)?.id).toBe('frame')
    g.nodes[0].collapsed = true
    expect(hitNode(g, 40, 40)?.id).toBe('frame')
    expect(hitNode(g, 500, 500)).toBeNull()
  })
  it('toggles selection without changing its input, and box-selects wholly enclosed nodes', () => {
    const selection = new Set(['card'])
    expect([...selectNode(selection, 'top', true)]).toEqual(['card', 'top'])
    expect([...selectNode(selection, 'card', true)]).toEqual([])
    expect([...selection]).toEqual(['card'])
    expect(nodesInBox(graph(), { x: 15, y: 15, width: 210, height: 110 })).toEqual(['card', 'top'])
  })
  it.each([0.1, 0.5, 1, 4])(
    'keeps 44px touch targets and coordinate transforms at zoom %s',
    (zoom) => {
      const node = graph().nodes[2],
        camera = { x: -130, y: 90, zoom }
      const point = toScreen(camera, node.x, node.y)
      expect(toWorld(camera, ...point)).toEqual([node.x, node.y])
      expect(hitResize(node, node.x + 21 / zoom, node.y - 21 / zoom, zoom, true)).toBe('nw')
      expect(hitResize(node, node.x - 23 / zoom, node.y - 23 / zoom, zoom, true)).toBeNull()
      expect(hitResize(node, node.x - 13 / zoom, node.y - 13 / zoom, zoom, false)).toBeNull()
    }
  )
  it('clamps crossing resize corners, keeping the opposite corner stationary', () => {
    const node = graph().nodes[2]
    expect(resizeRect(node, 'nw', 1000, 1000)).toEqual({ x: 180, y: 80, width: 40, height: 40 })
    expect(resizeRect(node, 'se', 50, 30)).toEqual({ x: 20, y: 20, width: 250, height: 130 })
  })
  it('moves nested groups and explicitly selected children once, preserving topology and extensions', () => {
    const g = graph(),
      ids = new Set(['frame', 'card']),
      before = structuredClone(g)
    const moving = moveIds(g, ids)
    expect([...moving].sort()).toEqual(['card', 'frame', 'inner', 'top'])
    expect(movePreview(g, moving, 70, -10).nodes[2]).toMatchObject({ x: 90, y: 10 })
    expect(g).toEqual(before)
    const next = editCanvas(g, [{ op: 'move', ids: [...ids], dx: 70, dy: -10 }]).graph
    for (let i = 0; i < g.nodes.length; i++)
      expect(next.nodes[i]).toMatchObject({ x: g.nodes[i].x + 70, y: g.nodes[i].y - 10 })
    expect(parentsOf(next)).toEqual(parentsOf(g))
    expect(next.edges).toEqual(g.edges)
    expect(next.extension).toEqual(g.extension)
    expect(next.nodes[2].extension).toEqual(g.nodes[2].extension)
    expect(() => editCanvas(g, [{ op: 'move', ids: ['missing'], dx: 10, dy: 10 }])).toThrow(
      /Unknown/
    )
    expect(() => editCanvas(g, [{ op: 'move', ids: ['card'], dx: Infinity, dy: 10 }])).toThrow()
    expect(g).toEqual(before)
  })
  it('keeps a selected root outside the moved frame even when the frame now surrounds it', () => {
    const g = graph()
    g.nodes.push({
      id: 'root',
      type: 'text',
      text: 'Outside',
      x: 500,
      y: 0,
      width: 100,
      height: 100,
    })
    const next = editCanvas(g, [{ op: 'move', ids: ['frame'], dx: 500, dy: 0 }]).graph
    expect(parentsOf(next).get('root')).toBeUndefined()
    expect(next.nodes.find((n) => n.id === 'root')).toMatchObject({ x: 500, y: 0 })
  })
  it('moves root cards without adding membership data or modifying unrelated cards', () => {
    const g: CanvasGraph = {
      nodes: [
        { id: 'one', type: 'text', text: 'One', x: 0, y: 0, width: 100, height: 100 },
        { id: 'two', type: 'text', text: 'Two', x: 300, y: 0, width: 100, height: 100 },
      ],
      edges: [],
    }
    const next = editCanvas(g, [{ op: 'move', ids: ['one'], dx: 10, dy: 20 }]).graph
    expect(next.nodes[0]).toEqual({ ...g.nodes[0], x: 10, y: 20 })
    expect(next.nodes[1]).toEqual(g.nodes[1])
  })
  it('previews a representative large multi-selection without reparsing graph data', () => {
    const g: CanvasGraph = {
      nodes: Array.from({ length: 2000 }, (_, i) => ({
        id: String(i),
        type: 'text',
        text: 'Card',
        x: i * 300,
        y: 0,
        width: 260,
        height: 160,
      })),
      edges: [],
    }
    const ids = new Set(g.nodes.map((n) => n.id)),
      start = performance.now(),
      moving = moveIds(g, ids)
    for (let i = 0; i < 30; i++) movePreview(g, moving, i, i)
    expect(performance.now() - start).toBeLessThan(150)
    expect(g.nodes[100].x).toBe(30000)
  })
})
