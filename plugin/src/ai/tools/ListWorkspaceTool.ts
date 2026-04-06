import type { AgentTool } from '../client'
import { ScopeResolver } from '../ScopeResolver'

export function createListWorkspaceTool(): AgentTool {
  return {
    name: 'workspace',
    label: 'List Workspace',
    description:
      'Show all files currently accessible in the workspace scope. Use this to understand what files you can work with.',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      const paths = ScopeResolver.getInstance().getAccessiblePaths()
      return {
        content: [
          {
            type: 'text',
            text: paths.length
              ? `${paths.length} accessible files:\n${paths.join('\n')}`
              : 'Workspace is empty. Ask the user to add files or folders.',
          },
        ],
      }
    },
  }
}
