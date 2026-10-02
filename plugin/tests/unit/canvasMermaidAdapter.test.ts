import { describe, expect, it, vi } from 'vitest'
import { bundledMermaid } from '@/canvas/mermaidAdapter'
import { createCanvasGraph } from '@/canvas/core/service'
const edges = vi.hoisted(() => [
  { start: 'sample-a', end: 'sample-b', text: '', type: 'arrow_open' },
  { start: 'sample-b', end: 'sample-c', text: 'both', type: 'double_arrow_point' },
  { start: 'sample-a', end: 'sample-c', text: 'forward', type: 'arrow_point' },
])
vi.mock('obsidian', () => ({
  loadMermaid: async () => ({
    mermaidAPI: {
      getDiagramFromText: async () => ({
        db: {
          getVertices: () =>
            new Map(
              ['sample-a', 'sample-b', 'sample-c'].map((id) => [
                id,
                { id, text: id, type: 'square' },
              ])
            ),
          getEdges: () => edges,
          getSubGraphs: () => [],
        },
      }),
    },
  }),
}))
describe('Mermaid edge semantics', () => {
  it('refuses an unsupported marker instead of silently changing its meaning', async () => {
    edges.push({ start: 'sample-a', end: 'sample-b', type: 'sample-unsupported-marker', text: '' })
    try {
      await expect(bundledMermaid.read('flowchart LR')).rejects.toThrow(
        /Unsupported Mermaid edge marker/
      )
    } finally {
      edges.pop()
    }
  })
  it('preserves A --- B, A <--> B and A --> B through import and JSON Canvas creation', async () => {
    const graph = await createCanvasGraph({ mermaid: 'flowchart LR' }, 'Sample', bundledMermaid)
    expect(graph.edges.map((edge) => [edge.fromEnd, edge.toEnd])).toEqual([
      ['none', 'none'],
      ['arrow', 'arrow'],
      ['none', 'arrow'],
    ])
    expect(graph.edges.map((edge) => edge.label)).toEqual(['', 'both', 'forward'])
  })
})
