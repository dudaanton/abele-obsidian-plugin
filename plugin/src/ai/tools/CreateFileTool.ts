import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '../ScopeResolver'

export function createCreateFileTool(): AgentTool {
  return {
    name: 'create',
    label: 'Create File',
    description: 'Create a new file in the vault with the specified content.',
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
      const { app } = GlobalStore.getInstance()
      if (app.vault.getAbstractFileByPath(path)) throw new Error(`File already exists: ${path}`)

      const parentFolder = path.split('/').slice(0, -1).join('/')
      if (parentFolder) {
        const parts = parentFolder.split('/')
        let current = ''
        for (const part of parts) {
          current = current ? `${current}/${part}` : part
          if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current)
        }
      }
      await app.vault.create(path, content)
      // Add new file to scope so agent can read/edit it
      ScopeResolver.getInstance().addFile(path)
      return {
        content: [{ type: 'text', text: `Created: ${path}` }],
        details: { diff: { old: '', new: content } },
      }
    },
  }
}
