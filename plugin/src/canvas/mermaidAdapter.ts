import { loadMermaid } from 'obsidian'
import type { MermaidPort } from './core/service'
/** Only the flowchart database is supported; no DOM scraping and no second Mermaid bundle. */
export const bundledMermaid: MermaidPort = {
  async read(source) {
    const mermaid = await loadMermaid()
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(source)
    if (!diagram.db?.getVertices || !diagram.db?.getEdges || !diagram.db?.getSubGraphs)
      throw new Error('Canvas import currently supports Mermaid flowcharts only')
    const raw = diagram.db.getVertices()
    const vertices: { id: string; text?: string; type?: string }[] =
      raw instanceof Map ? Array.from(raw.values()) : Object.values(raw)
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
    const edges: { start: string; end: string; text?: string }[] = diagram.db.getEdges()
    const groups: { id: string; title?: string; nodes: string[] }[] = diagram.db.getSubGraphs()
    const groupIds = new Set(groups.map((g) => g.id))
    return {
      nodes: vertices
        .filter((v) => !groupIds.has(v.id))
        .map((v) => ({
          id: v.id,
          label: v.text ?? v.id,
          shape: shape[v.type ?? ''] ?? 'rectangle',
        })),
      edges: edges.map((edge, i) => ({
        id: `mermaid-edge-${i + 1}`,
        fromNode: edge.start,
        toNode: edge.end,
        label: edge.text ?? '',
      })),
      groups: groups.map((g) => ({ id: g.id, label: g.title ?? g.id, ids: g.nodes })),
    }
  },
}
