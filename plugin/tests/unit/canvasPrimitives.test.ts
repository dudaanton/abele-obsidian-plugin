import { describe, expect, it } from 'vitest'
import { editCanvas } from '@/canvas/core/edit'
import { emptyCanvas, parseCanvas, serializeCanvas, SHAPES } from '@/canvas/core/model'
import { linesOf, lineBounds } from '@/canvas/core/primitives'
import { endpoint, paintedRoute } from '@/canvas/core/scene'
import { pictureRegion, paintCanvas } from '@/canvas/core/painter'
import { canvasOutline } from '@/canvas/core/read'
import { CanvasSession } from '@/canvas/core/session'

const line = {
  version: 1 as const,
  id: 'free',
  from: { x: -200, y: -100 },
  to: { x: 400, y: 300 },
  fromEnd: 'none' as const,
  toEnd: 'arrow' as const,
}
const node = {
  id: 'shape',
  type: 'text' as const,
  text: 'Decision',
  x: 0,
  y: 0,
  width: 200,
  height: 100,
}

describe('canvas free primitives', () => {
  it('uses stable ids, reads geometry, preserves unknown fields and undoes one atomic mixed batch', () => {
    const original = {
      ...emptyCanvas(),
      abele: { other: { opaque: true }, lines: [{ version: 8, id: 'future', payload: 'opaque' }] },
    }
    const ops = [
      {
        op: 'add_node',
        node: { id: 'card', kind: 'shape', shape: 'diamond', label: 'Decision', x: 0, y: 0 },
      },
      { op: 'add_line', line },
    ]
    const edited = editCanvas(original, ops).graph
    expect(linesOf(edited)).toEqual([line])
    expect(edited.abele?.lines).toEqual([{ version: 8, id: 'future', payload: 'opaque' }, line])
    expect(canvasOutline(edited, { detail: 'full' }).lines).toEqual([line])
    const session = new CanvasSession({ graph: original, revision: 'first' })
    session.beginDraft()
    session.updateDraft(() => edited)
    session.finishDraft()
    const token = session.prepareDraft()
    session.acknowledge(token, {
      graph: session.apply(token, session.committed),
      revision: 'second',
    })
    const undo = session.prepareUndo()
    session.acknowledge(undo, { graph: session.apply(undo, session.committed), revision: 'third' })
    expect(session.graph).toEqual(original)
    expect(parseCanvas(serializeCanvas(edited))).toEqual(edited)
  })
  it('moves, updates and removes free lines using the same id operations', () => {
    const graph = editCanvas(emptyCanvas(), [{ op: 'add_line', line }]).graph
    const changed = editCanvas(graph, [
      { op: 'move', ids: ['free'], dx: 10, dy: -20 },
      { op: 'update', id: 'free', patch: { label: 'Free caption', toEnd: 'none', extra: true } },
    ]).graph
    expect(linesOf(changed)[0]).toMatchObject({
      from: { x: -190, y: -120 },
      to: { x: 410, y: 280 },
      label: 'Free caption',
      extra: true,
    })
    expect(linesOf(editCanvas(changed, [{ op: 'remove', id: 'free' }]).graph)).toEqual([])
    expect(linesOf(graph)[0]).toEqual(line)
  })
  it('rejects duplicate ids and malformed geometry atomically, preserving incompatible extension containers', () => {
    const graph = editCanvas(emptyCanvas(), [{ op: 'add_line', line }]).graph
    for (const ops of [
      [{ op: 'add_node', node: { id: 'free', kind: 'text' } }],
      [{ op: 'add_line', line: { ...line, id: 'other', from: { x: Infinity, y: 0 } } }],
      [{ op: 'update', id: 'free', patch: { version: 2 } }],
      [{ op: 'update', id: 'free', patch: { to: line.from } }],
    ])
      expect(() => editCanvas(graph, ops)).toThrow()
    expect(() =>
      editCanvas({ ...emptyCanvas(), abele: { lines: { opaque: true } } }, [
        { op: 'add_line', line },
      ])
    ).toThrow(/lines/)
    expect(linesOf(graph)).toEqual([line])
  })
  it('fits and paints a line-only canvas including arrow and caption bounds', () => {
    const graph = editCanvas(emptyCanvas(), [
      { op: 'add_line', line: { ...line, label: 'A long free caption' } },
    ]).graph
    const region = pictureRegion(graph)
    expect(region.x).toBeLessThan(-200)
    expect(region.y).toBeLessThan(-100)
    expect(region.x + region.width).toBeGreaterThan(400)
    expect(lineBounds(line).width).toBeGreaterThan(600)
    const calls: string[] = []
    const ctx = new Proxy(
      {},
      {
        get:
          (_, key) =>
          (...args: unknown[]) => {
            calls.push(String(key))
            if (key === 'measureText') return { width: String(args[0]).length * 8 }
          },
      }
    ) as CanvasRenderingContext2D
    expect(() =>
      paintCanvas(ctx, graph, region, {
        paper: 'white',
        card: 'white',
        text: 'black',
        border: 'gray',
        accent: 'blue',
        muted: 'gray',
        font: 'sans-serif',
        size: 16,
        lineHeight: 1.4,
        presets: [],
      })
    ).not.toThrow()
    expect(calls).toContain('lineTo')
    expect(calls).toContain('rotate')
    expect(calls).toContain('fillText')
  })
})

describe('shape connections', () => {
  it.each(SHAPES)('routes to the painted %s boundary', (shape) => {
    const n = { ...node, styleAttributes: { shape } }
    const p = endpoint(n, 'left')
    expect(p.y).toBe(50)
    expect(p.x).toBeCloseTo(shape === 'parallelogram' ? 15 : 0)
    const b = endpoint(n, 'bottom')
    expect(b.x).toBe(100)
    expect(b.y).toBeCloseTo(shape === 'document' ? 88 : 100)
  })
  it('honours explicit sides when reconnecting a self-loop', () => {
    const graph = { nodes: [node], edges: [] }
    const route = paintedRoute(
      { id: 'loop', fromNode: 'shape', toNode: 'shape', fromSide: 'bottom', toSide: 'left' },
      graph
    )
    expect(route.points[0]).toEqual(endpoint(node, 'bottom'))
    expect(route.points.at(-1)).toEqual(endpoint(node, 'left'))
  })
  it('refuses movement that overflows free line coordinates instead of hiding the primitive', () => {
    const graph = editCanvas(emptyCanvas(), [
      { op: 'add_line', line: { ...line, from: { x: 1e308, y: 0 }, to: { x: 1e308, y: 100 } } },
    ]).graph
    expect(() => editCanvas(graph, [{ op: 'move', ids: ['free'], dx: 1e308, dy: 0 }])).toThrow()
    expect(linesOf(graph)).toHaveLength(1)
  })
  it('validates reconnected endpoints without losing unknown advanced fields', () => {
    const graph = {
      nodes: [node, { ...node, id: 'other', x: 400 }],
      edges: [{ id: 'edge', fromNode: 'shape', toNode: 'other', advanced: { opaque: true } }],
    }
    const changed = editCanvas(graph, [
      { op: 'update', id: 'edge', patch: { toNode: 'shape', toSide: 'top', label: 'Loop' } },
    ]).graph
    expect(changed.edges[0]).toMatchObject({ toNode: 'shape', advanced: { opaque: true } })
    expect(paintedRoute(changed.edges[0], changed).points.length).toBeGreaterThan(1)
    expect(() =>
      editCanvas(graph, [{ op: 'update', id: 'edge', patch: { toNode: 'missing' } }])
    ).toThrow(/Unknown id/)
    expect(graph.edges[0].toNode).toBe('other')
  })
})
