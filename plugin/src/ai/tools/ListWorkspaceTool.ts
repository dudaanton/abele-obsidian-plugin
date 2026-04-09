import type { AgentTool } from '../client'
import { ScopeResolver } from '../ScopeResolver'

const PAGE_SIZE = 100

export function createListWorkspaceTool(): AgentTool {
  return {
    name: 'workspace',
    label: 'List Workspace',
    description:
      'Show files accessible in the workspace scope. Returns up to 100 files at a time. Use offset to paginate if there are more.',
    parameters: {
      type: 'object',
      properties: {
        offset: {
          type: 'number',
          description: 'Start index for pagination (default 0)',
        },
      },
    },
    execute: async (_id, params) => {
      const offset = Math.max(0, (params.offset as number) || 0)
      const paths = ScopeResolver.getInstance().getAccessiblePaths()
      const total = paths.length

      if (total === 0) {
        return {
          content: [
            { type: 'text', text: 'Workspace is empty. Ask the user to add files or folders.' },
          ],
        }
      }

      const page = paths.slice(offset, offset + PAGE_SIZE)
      const shown = offset + page.length
      const remaining = total - shown

      let text = `${total} accessible files (showing ${offset + 1}–${shown}):\n${page.join('\n')}`
      if (remaining > 0) {
        text += `\n\n... ${remaining} more files. Use offset=${shown} to see next page.`
      }

      return { content: [{ type: 'text', text }] }
    },
  }
}
