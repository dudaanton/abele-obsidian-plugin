import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '../ScopeResolver'

export function createCreateFileTool(): AgentTool {
  return {
    name: 'create',
    label: 'Create File',
    description: 'Create a new file. The parent folder must be within workspace scope.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path for the new file' },
        content: { type: 'string', description: 'File content' },
      },
      required: ['path', 'content'],
    },
    execute: async (_id, params) => {
      const { path, content } = params as { path: string; content: string }
      const scope = ScopeResolver.getInstance()
      const parentFolder = path.split('/').slice(0, -1).join('/')
      if (parentFolder && !scope.fullVaultAccess.value && !scope.isFolderInScope(parentFolder)) {
        throw new Error(`Access denied: ${parentFolder} is not in workspace scope`)
      }
      const { app } = GlobalStore.getInstance()
      if (app.vault.getAbstractFileByPath(path)) throw new Error(`File already exists: ${path}`)

      // Ensure parent folders
      if (parentFolder) {
        const parts = parentFolder.split('/')
        let current = ''
        for (const part of parts) {
          current = current ? `${current}/${part}` : part
          if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current)
        }
      }
      await app.vault.create(path, content)
      scope.invalidate()
      return { content: [{ type: 'text', text: `Created: ${path}` }] }
    },
  }
}
