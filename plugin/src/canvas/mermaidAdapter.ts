import type { MermaidPort } from './core/service'
/** Canvas creation imports the typed flowchart model from the lazy pele parser. */
export const bundledMermaid: MermaidPort = {
  async read(source) {
    const { load, parse } = await import('pele/lazy')
    await load('flowchart')
    const diagram = parse(source)
    if (diagram.type !== 'flowchart')
      throw new Error('Canvas import currently supports Mermaid flowcharts only')
    const vertices = Array.from(diagram.nodes.values())
    const shape: Record<string, string> = {
      square: 'rectangle',
      rect: 'rectangle',
      round: 'pill',
      stadium: 'pill',
      diamond: 'diamond',
      circle: 'circle',
      doublecircle: 'circle',
      cylinder: 'database',
      subroutine: 'predefined-process',
      lean_right: 'parallelogram',
      lean_left: 'parallelogram',
    }
    const edges = diagram.edges
    const groups: { id: string; title?: string; nodes: string[] }[] = diagram.subgraphs
    const groupIds = new Set(groups.map((g) => g.id))
    return {
      direction:
        diagram.direction === 'TD'
          ? 'TB'
          : ['LR', 'RL', 'TB', 'BT'].includes(diagram.direction ?? '')
            ? (diagram.direction as 'LR' | 'RL' | 'TB' | 'BT')
            : undefined,
      nodes: vertices
        .filter((v) => !groupIds.has(v.id))
        .map((v) => ({
          id: v.id,
          label: v.text ?? v.id,
          shape: shape[v.type ?? ''] ?? 'rectangle',
        })),
      edges: edges.map((edge, i) => {
        const ends: Record<string, ['none' | 'arrow', 'none' | 'arrow']> = {
          arrow_open: ['none', 'none'],
          arrow_point: ['none', 'arrow'],
          double_arrow_point: ['arrow', 'arrow'],
        }
        const pair = ends[edge.type ?? '']
        if (!pair)
          throw new Error(
            `Unsupported Mermaid edge marker ${edge.type}; use explicit graph endpoints instead of a lossy import`
          )
        return {
          id: `mermaid-edge-${i + 1}`,
          fromNode: edge.start,
          toNode: edge.end,
          label: edge.text ?? '',
          fromEnd: pair[0],
          toEnd: pair[1],
        }
      }),
      groups: groups.map((g) => ({ id: g.id, label: g.title ?? g.id, ids: g.nodes })),
    }
  },
}
