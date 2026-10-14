import { describe, expect, it } from 'vitest'
import { editCanvas } from '@/canvas/core/edit'
import { parentsOf, type CanvasGraph } from '@/canvas/core/model'
import { inkEntries } from '@/canvas/core/ink'
import { frameOps, landingFrame } from '@/canvas/input'

const garden = (): CanvasGraph => ({
  nodes: [
    { id: 'shelf', type: 'group', x: 0, y: 0, width: 600, height: 400, label: 'Shelf' },
    { id: 'pots', type: 'group', x: 20, y: 40, width: 260, height: 200, label: 'Pots' },
    { id: 'mint', type: 'text', text: 'Mint', x: 40, y: 80, width: 100, height: 60 },
    { id: 'sage', type: 'text', text: 'Sage', x: 320, y: 80, width: 100, height: 60 },
    { id: 'tray', type: 'text', text: 'Tray', x: 900, y: 80, width: 100, height: 60 },
  ],
  edges: [],
})

describe('drawing a frame', () => {
  it('takes in what lies whole inside it and keeps a nested frame nested', () => {
    const graph = garden()
    const ops = frameOps(graph, { x: 10, y: 20, width: 440, height: 300 })
    const after = editCanvas(graph, ops).graph
    const id = (ops[0] as { id: string }).id
    const parents = parentsOf(after)
    expect(parents.get('pots')).toBe(id)
    expect(parents.get('sage')).toBe(id)
    // Mint stays in its own frame, which now sits in the new one.
    expect(parents.get('mint')).toBe('pots')
    expect(parents.get(id)).toBe('shelf')
    const frame = after.nodes.find((n) => n.id === id)!
    expect([frame.x, frame.y, frame.width, frame.height, frame.label]).toEqual([
      10,
      20,
      440,
      300,
      'Frame',
    ])
  })
  it('draws an empty frame where nothing lies inside', () => {
    const graph = garden()
    const ops = frameOps(graph, { x: 1200, y: 0, width: 300, height: 200 })
    expect(ops).toHaveLength(1)
    const after = editCanvas(graph, ops).graph
    expect(after.nodes.at(-1)).toMatchObject({ type: 'group', label: 'Frame', x: 1200 })
  })
})

describe('carrying a card over frames', () => {
  it('lights the smallest frame that would hold it whole', () => {
    const graph = garden()
    const moved = {
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === 'tray' ? { ...n, x: 60, y: 120 } : n)),
    }
    expect(landingFrame(moved, new Set(['tray']), new Set(['tray']))).toBe('pots')
  })
  it('lights nothing when the card is outside every frame or half in one', () => {
    const graph = garden()
    expect(landingFrame(graph, new Set(['tray']), new Set(['tray']))).toBeNull()
    const half = {
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === 'tray' ? { ...n, x: 560, y: 80 } : n)),
    }
    expect(landingFrame(half, new Set(['tray']), new Set(['tray']))).toBeNull()
  })
  it('never lights a frame that is itself being carried', () => {
    const graph = garden()
    expect(landingFrame(graph, new Set(['pots']), new Set(['pots', 'mint']))).toBe('shelf')
  })
})

describe('a folded frame', () => {
  it('hides the ink drawn in it along with its cards', () => {
    const graph = garden()
    const drawn = editCanvas(graph, [
      {
        op: 'add_ink',
        node: 'pots',
        stroke: {
          version: 1,
          id: 'leaf',
          tool: 'pen',
          color: '',
          size: 2,
          points: [10, 10, 0.5, 40, 40, 0.5],
          frame: { width: 260, height: 200 },
        },
      },
    ]).graph
    expect(inkEntries(drawn).map((e) => e.stroke.id)).toEqual(['leaf'])
    const folded = editCanvas(drawn, [{ op: 'collapse', id: 'pots', collapsed: true }]).graph
    expect(inkEntries(folded)).toEqual([])
  })
})
