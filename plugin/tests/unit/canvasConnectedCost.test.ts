import { describe, expect, it, vi } from 'vitest'
import { editCanvas } from '@/canvas/core/edit'
import { emptyCanvas } from '@/canvas/core/model'

describe('connected graph transaction cost', () => {
  it('does not rescan every accumulated edge with linear endpoint searches', () => {
    const count = 1000
    const ops = [
      ...Array.from({ length: count }, (_, i) => ({
        op: 'add_node',
        node: { id: `sample-${i}`, kind: 'text', label: `Sample ${i}` },
      })),
      ...Array.from({ length: count - 1 }, (_, i) => ({
        op: 'connect',
        edge: { id: `sample-edge-${i}`, fromNode: `sample-${i}`, toNode: `sample-${i + 1}` },
      })),
    ]
    let comparisons = 0
    const find = Array.prototype.find,
      some = Array.prototype.some
    const wrap =
      (predicate: (value: unknown, index: number, array: unknown[]) => unknown) =>
      (value: unknown, index: number, array: unknown[]) => {
        if (value && typeof value === 'object' && 'id' in value) comparisons++
        return predicate(value, index, array)
      }
    const findSpy = vi
      .spyOn(Array.prototype, 'find')
      .mockImplementation(function (predicate, thisArg) {
        return find.call(this, wrap(predicate.bind(thisArg)))
      })
    const someSpy = vi
      .spyOn(Array.prototype, 'some')
      .mockImplementation(function (predicate, thisArg) {
        return some.call(this, wrap(predicate.bind(thisArg)))
      })
    try {
      const graph = editCanvas(emptyCanvas(), ops).graph
      expect(graph.nodes).toHaveLength(count)
      expect(graph.edges).toHaveLength(count - 1)
      expect(comparisons).toBeLessThan(count * 40)
      console.info(
        `Connected sample graph: ${count} nodes, ${count - 1} edges, ${comparisons} linear id comparisons`
      )
    } finally {
      findSpy.mockRestore()
      someSpy.mockRestore()
    }
  }, 60_000)
  it('keeps indexed lookups correct across updates, removal and re-addition', () => {
    const graph = editCanvas(emptyCanvas(), [
      { op: 'add_node', node: { id: 'sample-a', kind: 'text' } },
      { op: 'add_node', node: { id: 'sample-b', kind: 'text' } },
      { op: 'connect', edge: { id: 'sample-flow', fromNode: 'sample-a', toNode: 'sample-b' } },
      { op: 'update', id: 'sample-flow', patch: { label: 'Updated' } },
      { op: 'remove', id: 'sample-b' },
      { op: 'add_node', node: { id: 'sample-b', kind: 'text', label: 'Re-added' } },
      { op: 'connect', edge: { id: 'sample-flow', fromNode: 'sample-a', toNode: 'sample-b' } },
    ]).graph
    expect(graph.nodes.find((n) => n.id === 'sample-b')?.text).toBe('Re-added')
    expect(graph.edges).toHaveLength(1)
  })
})
