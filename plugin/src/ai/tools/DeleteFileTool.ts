import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '../ScopeResolver'
import { TFile } from 'obsidian'

export function createDeleteFileTool(): AgentTool {
  return {
    name: 'rm',
    label: 'Delete File',
    description: 'Delete a file (moves to trash). File must be in workspace scope.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to delete' },
      },
      required: ['path'],
    },
    execute: async (_id, params) => {
      const path = params.path as string
      if (!ScopeResolver.getInstance().isInScope(path)) {
        throw new Error(`Access denied: ${path} is not in workspace scope`)
      }
      const { app } = GlobalStore.getInstance()
      const file = app.vault.getAbstractFileByPath(path)
      if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`)
      await app.vault.trash(file, false)
      ScopeResolver.getInstance().invalidate()
      return { content: [{ type: 'text', text: `Deleted: ${path}` }] }
    },
  }
}
