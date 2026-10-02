import { describe, expect, it } from 'vitest'
import { parseCanvas, serializeCanvas, emptyCanvas, parentsOf } from '@/canvas/core/model'
import { editCanvas } from '@/canvas/core/edit'
import { layoutCanvas } from '@/canvas/core/layout'
import { lintCanvas } from '@/canvas/core/lint'
import { canvasOutline } from '@/canvas/core/read'

const sample = () =>
  editCanvas(emptyCanvas(), [
    { op: 'add_node', node: { id: 'alpha', kind: 'shape', label: 'Alpha', shape: 'diamond' } },
    { op: 'add_node', node: { id: 'beta', kind: 'text', label: 'Beta' } },
    { op: 'connect', edge: { id: 'flow', fromNode: 'alpha', toNode: 'beta', label: 'next' } },
  ]).graph

describe('portable canvas model and atomic edits', () => {
  it('uses only standard types and preserves extension fields at every level', () => {
    const graph = sample()
    graph.abele = { sample: { future: [1, false] } }
    graph.nodes[0].sampleExtension = { flag: true }
    graph.edges[0].styleAttributes = { path: 'dotted', arrow: 'triangle', future: 'sample' }
    const back = parseCanvas(serializeCanvas(graph))
    expect(back).toEqual(graph)
    expect(back.nodes[0].type).toBe('text')
    expect(back.nodes[0].styleAttributes?.shape).toBe('diamond')
  })
  it.each([
    { nodes: [{ id: 'x', type: 'shape', x: 0, y: 0, width: 10, height: 10 }], edges: [] },
    { nodes: [{ id: 'x', type: 'text', text: '', x: 0, y: 0, width: -1, height: 10 }], edges: [] },
    { nodes: [{ id: 'x', type: 'file', x: 0, y: 0, width: 10, height: 10 }], edges: [] },
  ])('rejects destructive/invalid input instead of silently dropping it', (data) => {
    expect(() => parseCanvas(JSON.stringify(data))).toThrow()
  })
  it('rejects duplicate node/edge ids and dangling connections', () => {
    expect(() =>
      editCanvas(sample(), [
        { op: 'connect', edge: { id: 'alpha', fromNode: 'alpha', toNode: 'beta' } },
      ])
    ).toThrow(/duplicate/i)
    expect(() =>
      editCanvas(sample(), [
        { op: 'connect', edge: { id: 'other', fromNode: 'missing', toNode: 'beta' } },
      ])
    ).toThrow(/missing/i)
  })
  it('fails the entire batch with an op index and suggestion, without mutating its input', () => {
    const graph = sample(),
      before = serializeCanvas(graph)
    try {
      editCanvas(graph, [
        { op: 'update', id: 'alpha', patch: { text: 'Changed' } },
        { op: 'update', id: 'alph', patch: { text: 'No' } },
      ])
      expect.fail('invalid batch accepted')
    } catch (error) {
      expect(String(error)).toMatch(/op 1.*alph.*alpha/i)
    }
    expect(serializeCanvas(graph)).toBe(before)
  })
  it('merges styles and local data, preserving unknown nested fields', () => {
    const graph = sample()
    graph.nodes[0].abele = { sample: 'keep' }
    graph.nodes[0].styleAttributes!.border = 'dotted'
    const next = editCanvas(graph, [
      { op: 'style', id: 'alpha', styleAttributes: { shape: 'pill' } },
      { op: 'update', id: 'alpha', patch: { abele: { level: 2 } } },
    ]).graph
    expect(next.nodes[0].styleAttributes).toEqual({ shape: 'pill', border: 'dotted' })
    expect(next.nodes[0].abele).toEqual({ sample: 'keep', level: 2 })
  })
  it('groups, collapses and ungroups by id; refuses containment cycles', () => {
    let graph = editCanvas(sample(), [
      { op: 'group', id: 'level', label: 'Overview', ids: ['alpha', 'beta'] },
      { op: 'collapse', id: 'level', collapsed: true },
    ]).graph
    expect(parentsOf(graph).get('alpha')).toBe('level')
    expect(graph.nodes.find((n) => n.id === 'level')?.collapsed).toBe(true)
    expect(() =>
      editCanvas(graph, [{ op: 'update', id: 'level', patch: { abele: { parent: 'level' } } }])
    ).toThrow(/cycle/i)
    graph = editCanvas(graph, [{ op: 'ungroup', id: 'level' }]).graph
    expect(parentsOf(graph).get('alpha')).toBeUndefined()
    expect(graph.nodes).toHaveLength(2)
  })
  it('removes incident edges and promotes children of a removed group', () => {
    const grouped = editCanvas(sample(), [
      { op: 'group', id: 'level', ids: ['alpha', 'beta'] },
    ]).graph
    const ungrouped = editCanvas(grouped, [{ op: 'remove', id: 'level' }]).graph
    expect(ungrouped.nodes).toHaveLength(2)
    expect(parentsOf(ungrouped).get('alpha')).toBeUndefined()
    const removed = editCanvas(ungrouped, [{ op: 'remove', id: 'alpha' }]).graph
    expect(removed.edges).toHaveLength(0)
  })
  it('infers native geometric grouping and reports hierarchy without depending on array order', () => {
    const graph = sample()
    graph.nodes.push({
      id: 'level',
      type: 'group',
      label: 'Level',
      x: -10,
      y: -10,
      width: 1000,
      height: 1000,
    })
    const tree = canvasOutline(graph)
    graph.nodes.reverse()
    expect(canvasOutline(graph)).toEqual(tree)
    expect(parentsOf(graph).get('alpha')).toBe('level')
    expect(JSON.stringify(tree)).not.toContain('"x":')
  })
})

describe('layout and deterministic self-check', () => {
  it.each(['layered', 'tree', 'radial', 'grid'] as const)(
    'lays out %s without sibling overlaps',
    (algorithm) => {
      const graph = layoutCanvas(sample(), { algorithm })
      expect(lintCanvas(graph).filter((w) => w.code === 'overlap')).toEqual([])
      expect(layoutCanvas(sample(), { algorithm })).toEqual(graph)
    }
  )
  it('obeys direction, fixed ids and group scope with nested groups and cross-group edges', () => {
    const graph = editCanvas(sample(), [
      { op: 'add_node', node: { id: 'gamma', kind: 'text', label: 'Gamma', x: 900, y: 900 } },
      { op: 'group', id: 'inner', ids: ['alpha', 'beta'] },
      { op: 'group', id: 'outer', ids: ['inner'] },
      { op: 'connect', edge: { id: 'cross', fromNode: 'beta', toNode: 'gamma' } },
    ]).graph
    const before = graph.nodes.find((n) => n.id === 'gamma')!
    const scoped = layoutCanvas(graph, { scope: 'inner', direction: 'TB' })
    expect(scoped.nodes.find((n) => n.id === 'gamma')).toEqual(before)
    const all = layoutCanvas(scoped, { direction: 'LR', keep: ['gamma'] })
    expect(all.nodes.find((n) => n.id === 'gamma')).toEqual(before)
    expect(lintCanvas(all).filter((w) => w.code === 'overlap')).toEqual([])
  })
  it('handles cycles and a compound graph with many nodes', () => {
    const graph = sample()
    graph.edges.push({ id: 'back', fromNode: 'beta', toNode: 'alpha' })
    expect(layoutCanvas(graph, {}).nodes.every((n) => Number.isFinite(n.x))).toBe(true)
    const large = editCanvas(
      emptyCanvas(),
      Array.from({ length: 120 }, (_, i) => ({
        op: 'add_node',
        node: { id: `sample-${i}`, kind: 'text', label: `Sample ${i}` },
      }))
    ).graph
    expect(lintCanvas(layoutCanvas(large, {})).filter((w) => w.code === 'overlap')).toHaveLength(0)
  })
  it.each(['grid', 'tree'] as const)(
    'keeps non-square %s cells separate in vertical directions',
    (algorithm) => {
      const graph = editCanvas(
        emptyCanvas(),
        Array.from({ length: 9 }, (_, i) => ({
          op: 'add_node',
          node: { id: `wide-${i}`, kind: 'text', label: 'Wide', width: 600, height: 80 },
        }))
      ).graph
      expect(
        lintCanvas(layoutCanvas(graph, { algorithm, direction: 'TB' })).filter(
          (w) => w.code === 'overlap'
        )
      ).toEqual([])
    }
  )
  it('pins a kept group and all of its children, not just its outline', () => {
    const graph = editCanvas(sample(), [{ op: 'group', id: 'level', ids: ['alpha', 'beta'] }]).graph
    expect(layoutCanvas(graph, { keep: ['level'] }).nodes).toEqual(graph.nodes)
  })
  it('reports overlap, node-crossing edges, clipped text, isolation and invalid step ids', () => {
    const graph = sample()
    graph.nodes[1].x = 10
    graph.nodes[1].y = 10
    graph.nodes[0].text = 'Sample text '.repeat(100)
    graph.abele = { steps: [{ reveal: ['absent'], focus: 'also-absent', say: 'Sample' }] }
    graph.nodes.push({
      id: 'island',
      type: 'text',
      text: 'Island',
      x: 900,
      y: 0,
      width: 100,
      height: 100,
    })
    expect(lintCanvas(graph).map((w) => w.code)).toEqual(
      expect.arrayContaining(['overlap', 'clipped-text', 'isolated', 'missing-step-id'])
    )
    const routed = layoutCanvas(sample(), { direction: 'LR' })
    const a = routed.nodes[0],
      b = routed.nodes[1]
    routed.nodes.push({
      id: 'obstacle',
      type: 'text',
      text: '',
      x: (a.x + a.width + b.x) / 2 - 5,
      y: a.y + a.height / 2 - 5,
      width: 10,
      height: 10,
    })
    expect(lintCanvas(routed).map((w) => w.code)).toContain('edge-crossing')
  })
})
