import { describe, expect, it } from 'vitest'
import { bundledMermaid } from '@/canvas/mermaidAdapter'
import { createCanvasGraph } from '@/canvas/core/service'
describe('Mermaid edge semantics', () => {
  it('keeps the flowchart direction, nested groups, labels and shapes', async () => {
    const parsed = await bundledMermaid.read(
      'flowchart TB\nsubgraph outer[Overview]\nsubgraph inner[Detail]\n A[(Storage)] -->|next| B{Choice}\nend\nend'
    )
    expect(parsed.direction).toBe('TB')
    expect(parsed.nodes).toEqual([
      { id: 'A', label: 'Storage', shape: 'database' },
      { id: 'B', label: 'Choice', shape: 'diamond' },
    ])
    expect(parsed.groups.map((group) => group.id)).toEqual(['inner', 'outer'])
    const graph = await createCanvasGraph(
      { mermaid: 'flowchart TB\n A --> B' },
      'Sample',
      bundledMermaid
    )
    expect(graph.nodes[1].y).toBeGreaterThan(graph.nodes[0].y)
  })
  it('refuses an unsupported marker instead of silently changing its meaning', async () => {
    await expect(bundledMermaid.read('flowchart LR\n A --x B')).rejects.toThrow(
      /Unsupported Mermaid edge marker/
    )
  })
  it('preserves A --- B, A <--> B and A --> B through import and JSON Canvas creation', async () => {
    const graph = await createCanvasGraph(
      { mermaid: 'flowchart LR\n A --- B\n B <-->|both| C\n A -->|forward| C' },
      'Sample',
      bundledMermaid
    )
    expect(graph.edges.map((edge) => [edge.fromEnd, edge.toEnd])).toEqual([
      ['none', 'none'],
      ['arrow', 'arrow'],
      ['none', 'arrow'],
    ])
    expect(graph.edges.map((edge) => edge.label)).toEqual(['', 'both', 'forward'])
  })
})
