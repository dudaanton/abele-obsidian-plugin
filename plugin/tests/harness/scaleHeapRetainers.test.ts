import { expect, it } from 'vitest'
import { retainedGraph } from '../scale/heap-retainers.mjs'

it.each(['shortcut', 'weak-map'])('ignores a redundant %s ownership edge', (kind) => {
  const pair = ' / part of key (Object @3) -> value (Object @7) pair in WeakMap (table @5))'
  const snapshot = {
    snapshot: {
      meta: {
        node_fields: ['type', 'name', 'id', 'self_size', 'edge_count'],
        node_types: [['synthetic', 'object']],
        edge_fields: ['type', 'name_or_index', 'to_node'],
        edge_types: [['property', 'weak', 'shortcut', 'internal']],
      },
    },
    strings: ['root', 'left', 'right', 'shared', '1' + pair, '2' + pair],
    nodes: [0, 0, 1, 0, 2, 1, 1, 3, 10, 1, 1, 2, 5, 20, 1, 1, 3, 7, 30, 0],
    edges: [
      0,
      0,
      5,
      2,
      0,
      10,
      kind === 'shortcut' ? 0 : 3,
      4,
      15,
      kind === 'shortcut' ? 2 : 3,
      5,
      15,
    ],
  }
  expect([...retainedGraph(snapshot).retained]).toEqual([60, 40, 20, 30])
})

it('counts shared objects only under their common dominator and excludes weak edges', () => {
  const snapshot = {
    snapshot: {
      meta: {
        node_fields: ['type', 'name', 'id', 'self_size', 'edge_count'],
        node_types: [['synthetic', 'object']],
        edge_fields: ['type', 'name_or_index', 'to_node'],
        edge_types: [['property', 'weak']],
      },
    },
    strings: ['root', 'left', 'right', 'shared', 'private'],
    nodes: [0, 0, 1, 0, 3, 1, 1, 3, 10, 2, 1, 2, 5, 20, 1, 1, 3, 7, 30, 0, 1, 4, 9, 40, 1],
    edges: [0, 0, 5, 0, 0, 10, 1, 0, 20, 0, 0, 15, 0, 0, 20, 0, 0, 15, 0, 0, 5],
  }
  const result = retainedGraph(snapshot)
  expect([...result.retained]).toEqual([100, 50, 20, 30, 40])
  expect([...result.dominators]).toEqual([0, 0, 0, 0, 1])
  expect(result.reachable).toBe(5)
})

it('matches removal-based retained sizes on cyclic graphs with unreachable nodes', () => {
  let seed = 17
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  for (let run = 0; run < 50; run++) {
    const count = 25,
      adjacency: number[][] = Array.from({ length: count }, () => [])
    for (let n = 0; n < count; n++)
      for (let j = 0; j < 3; j++)
        if (random() < 0.7) adjacency[n].push(Math.floor(random() * count))
    const reachable = (removed: number) => {
      const seen = new Set<number>(),
        stack = removed === 0 ? [] : [0]
      while (stack.length) {
        const n = stack.pop()!
        if (seen.has(n)) continue
        seen.add(n)
        for (const target of adjacency[n]) if (target !== removed) stack.push(target)
      }
      return seen
    }
    const baseline = reachable(-1)
    const snapshot = {
      snapshot: {
        meta: {
          node_fields: ['edge_count', 'self_size'],
          node_types: [],
          edge_fields: ['type', 'to_node'],
          edge_types: [['property', 'weak']],
        },
      },
      nodes: adjacency.flatMap((edges, n) => [edges.length, n + 1]),
      edges: adjacency.flatMap((edges) => edges.flatMap((n) => [0, n * 2])),
    }
    const graph = retainedGraph(snapshot)
    for (let n = 0; n < count; n++) {
      const remaining = reachable(n)
      const expected = baseline.has(n)
        ? [...baseline].filter((v) => !remaining.has(v)).reduce((sum, v) => sum + v + 1, 0)
        : 0
      expect(graph.retained[n]).toBe(expected)
    }
  }
})

it('reads snapshot arrays in bounded JSON batches across escaped text and nested values', async () => {
  const { parseSnapshotBuffer } = await import('../scale/heap-retainers.mjs')
  const value = {
    snapshot: { meta: { node_fields: ['type', 'name'] } },
    nodes: Array.from({ length: 300 }, (_, index) => index),
    edges: [0, 1, 2],
    strings: ['sample,] text', 'escaped \\" quote', 'sample 层', 'line\ntext'],
    trace_tree: [[1, [2, 3]], [], { sample: [4, 5] }],
    samples: [],
  }
  const source = JSON.stringify(value)
  const batches = []
  const parse = (text) => {
    batches.push(text.length)
    return JSON.parse(text)
  }
  expect(parseSnapshotBuffer(Buffer.from(source), 32, parse)).toEqual(value)
  expect(Math.max(...batches)).toBeLessThan(source.length / 2)
  expect(batches.length).toBeGreaterThan(10)
  expect(() => parseSnapshotBuffer(Buffer.from('{"nodes":[1,]}'), 2)).toThrow()
})
