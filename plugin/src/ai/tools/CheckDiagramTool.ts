import type { AgentTool } from '../client'
import { renderDiagram } from '@/mermaid/renderMermaid'

/** Uses the same renderer as notes, without mounting anything or writing files. */
export function createCheckDiagramTool(): AgentTool {
  return {
    name: 'check_diagram',
    label: 'Check diagram',
    description:
      'Validate Mermaid source with pele before writing a mermaid or pele fence. Returns ok, diagram type and pixel size, or error, line, column and caret snippet. Reads only; does not write notes.',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Diagram source without the code fence.' },
      },
      required: ['source'],
    },
    execute: async (_id, params) => {
      if (typeof params.source !== 'string') throw new Error('source must be a string')
      const result = await renderDiagram(params.source, 'light')
      const value = result.ok
        ? { ok: true, type: result.type, width: result.width, height: result.height }
        : result
      return { content: [{ type: 'text', text: JSON.stringify(value) }] }
    },
  }
}
