import { describe, expect, it } from 'vitest'
import { editCanvas } from '@/canvas/core/edit'
import {
  addInk,
  inkEntries,
  inkBounds,
  inkTransform,
  hitInk,
  eraseInk,
  lassoInk,
  type CanvasInk,
} from '@/canvas/core/ink'
import type { CanvasGraph } from '@/canvas/core/model'

const stroke = (id = 'ink'): CanvasInk => ({
  version: 1,
  id,
  tool: 'pen',
  color: '1',
  size: 2,
  points: [0, 0, 0.2, 100, 0, 0.8],
})
function scene(): CanvasGraph {
  const g: CanvasGraph = {
    nodes: [{ id: 'card', type: 'text', text: 'Sample', x: 100, y: 200, width: 200, height: 50 }],
    edges: [],
  }
  addInk(g, { ...stroke(), frame: { width: 100, height: 100 } }, 'card')
  return g
}
describe('canvas ink editing', () => {
  it('picks and partially erases in world coordinates after nonuniform resize', () => {
    const g = scene(),
      e = inkEntries(g)[0]
    expect(hitInk(e, 200, 206, 8)).toBe(true)
    expect(hitInk(e, 200, 215, 8)).toBe(false)
    const parts = eraseInk(e, 200, 200, 10, () => 'fragment')
    expect(parts).toHaveLength(2)
    expect(parts[0].id).toBe('ink')
    expect(parts[1].id).toBe('fragment')
    expect(parts.every((s) => s.frame?.width === 100 && s.color === '1')).toBe(true)
    expect(parts[0].points.at(-3)).toBeLessThan(50)
    expect(parts[1].points[0]).toBeGreaterThan(50)
    expect(parts[0].points.at(-1)).toBeGreaterThan(0.2)
    expect(eraseInk(e, 200, 500, 10, () => 'unused')).toEqual([e.stroke])
  })
  it('picks the rendered curve rather than only straight chords between sparse pen samples', () => {
    const e = {
      stroke: {
        ...stroke(),
        size: 0.1,
        points: [0, 0, 0.5, 100, 0, 0.5, 100, 100, 0.5, 200, 100, 0.5],
      },
    }
    expect(hitInk(e, 104.2, 25.8, 2)).toBe(true)
    expect(hitInk(e, 100, 25, 2)).toBe(false)
  })
  it('keeps screen-space picking tolerance at different zoom levels and marker cut pressures', () => {
    const e = { stroke: { ...stroke(), size: 0.1, tool: 'marker' as const } }
    for (const zoom of [0.25, 1, 4]) {
      expect(hitInk(e, 50, 6 / zoom, 8 / zoom)).toBe(true)
      expect(hitInk(e, 50, 12 / zoom, 8 / zoom)).toBe(false)
    }
    const parts = eraseInk(e, 50, 0, 10, () => 'fragment')
    expect(parts[0].points[2]).toBeCloseTo(0.2)
    expect(parts[1].points.at(-1)).toBeCloseTo(0.8)
  })
  it('lassos transformed strokes and visible cards, not hidden descendants', () => {
    const g = scene()
    expect(lassoInk(g, [90, 190, 320, 190, 320, 270, 90, 270])).toEqual(['card', 'ink'])
    g.nodes.unshift({
      id: 'group',
      type: 'group',
      x: 0,
      y: 0,
      width: 400,
      height: 400,
      collapsed: true,
    })
    expect(lassoInk(g, [90, 190, 320, 190, 320, 270, 90, 270])).toEqual([])
  })
  it('detaches and attaches without changing the outline, even after nonuniform resizing', () => {
    const g = scene(),
      before = inkBounds(inkEntries(g)[0])
    const detached = editCanvas(g, [{ op: 'attach_ink', id: 'ink' }]).graph
    expect(inkBounds(inkEntries(detached)[0])).toEqual(before)
    expect(inkEntries(detached)[0].node).toBeUndefined()
    const attached = editCanvas(detached, [{ op: 'attach_ink', id: 'ink', node: 'card' }]).graph
    expect(inkBounds(inkEntries(attached)[0])).toEqual(before)
    expect(inkEntries(attached)[0].stroke.points).toEqual(stroke().points)
  })
  it('moves mixed selections once, scales their outlines and recolours/removes ink', () => {
    const g = scene()
    addInk(g, stroke('free'))
    const result = editCanvas(g, [
      { op: 'move', ids: ['card', 'ink', 'free'], dx: 20, dy: 30 },
    ]).graph
    expect(inkTransform(inkEntries(result).find((e) => e.stroke.id === 'ink')!)).toEqual({
      x: 120,
      y: 230,
      sx: 2,
      sy: 0.5,
    })
    const scaled = editCanvas(result, [
      { op: 'scale', ids: ['card', 'ink', 'free'], x: 0, y: 0, factor: 2 },
      { op: 'update_ink', id: 'free', patch: { color: '4' } },
    ]).graph
    expect(inkTransform(inkEntries(scaled).find((e) => e.stroke.id === 'ink')!)).toEqual({
      x: 240,
      y: 460,
      sx: 4,
      sy: 1,
    })
    expect(inkEntries(scaled).find((e) => e.stroke.id === 'free')?.stroke.color).toBe('4')
    expect(
      inkEntries(
        editCanvas(scaled, [
          { op: 'remove', id: 'card' },
          { op: 'remove', id: 'free' },
        ]).graph
      )
    ).toEqual([])
  })
  it('groups mixed cards/ink and promotes group-owned ink on ungroup without changing appearance', () => {
    const g = scene()
    addInk(g, stroke('free'))
    const grouped = editCanvas(g, [
      { op: 'group', id: 'group', ids: ['card', 'ink', 'free'] },
    ]).graph
    expect(inkEntries(grouped).find((e) => e.stroke.id === 'ink')?.node?.id).toBe('card')
    expect(inkEntries(grouped).find((e) => e.stroke.id === 'free')?.node?.id).toBe('group')
    const moved = editCanvas(grouped, [
      { op: 'move', ids: ['group'], dx: 30, dy: 40 },
      { op: 'update', id: 'group', patch: { width: 500, height: 350 } },
    ]).graph
    const before = inkBounds(inkEntries(moved).find((e) => e.stroke.id === 'free')!)
    const ungrouped = editCanvas(moved, [{ op: 'ungroup', id: 'group' }]).graph
    expect(inkEntries(ungrouped).find((e) => e.stroke.id === 'free')?.node).toBeUndefined()
    expect(inkBounds(inkEntries(ungrouped).find((e) => e.stroke.id === 'free')!)).toEqual(before)
  })
  it('refuses ungrouping opaque group ink rather than silently deleting or guessing its frame', () => {
    const g: CanvasGraph = {
      nodes: [
        {
          id: 'group',
          type: 'group',
          x: 0,
          y: 0,
          width: 200,
          height: 200,
          abele: { ink: [{ id: 'future', version: 9, payload: 'opaque' }] },
        },
      ],
      edges: [],
    }
    expect(() => editCanvas(g, [{ op: 'ungroup', id: 'group' }])).toThrow(/opaque/)
    expect(g.nodes[0].abele?.ink).toEqual([{ id: 'future', version: 9, payload: 'opaque' }])
  })
  it('preserves opaque entries and refuses invalid operations atomically', () => {
    const g = scene()
    g.abele = { ink: [{ id: 'opaque', version: 9 }] }
    expect(() => editCanvas(g, [{ op: 'remove', id: 'opaque' }])).toThrow()
    expect(() => editCanvas(g, [{ op: 'attach_ink', id: 'ink', node: 'missing' }])).toThrow()
    expect(() =>
      editCanvas(g, [{ op: 'update_ink', id: 'ink', patch: { id: 'changed' } }])
    ).toThrow()
    expect(() => editCanvas(g, [{ op: 'scale', ids: ['ink'], x: 0, y: 0, factor: 0 }])).toThrow()
    expect(g.abele.ink).toEqual([{ id: 'opaque', version: 9 }])
  })
})
