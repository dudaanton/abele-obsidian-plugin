import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '../ScopeResolver'
import { TFile } from 'obsidian'

export function createMoveFileTool(): AgentTool {
  return {
    name: 'mv',
    label: 'Move/Rename File',
    description: 'Move or rename a file. Source must be in workspace scope.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Current file path' },
        to: { type: 'string', description: 'New file path' },
      },
      required: ['from', 'to'],
    },
    execute: async (_id, params) => {
      const { from, to } = params as { from: string; to: string }
      if (!from) throw new Error('Missing required parameter: from')
      if (!to) throw new Error('Missing required parameter: to')
      if (!ScopeResolver.getInstance().isInScope(from)) {
        throw new Error(`Access denied: ${from} is not in workspace scope`)
      }
      const { app } = GlobalStore.getInstance()
      const file = app.vault.getAbstractFileByPath(from)
      if (!(file instanceof TFile)) throw new Error(`File not found: ${from}`)
      if (app.vault.getAbstractFileByPath(to)) throw new Error(`Destination exists: ${to}`)
      await app.fileManager.renameFile(file, to)
      ScopeResolver.getInstance().invalidate()
      return { content: [{ type: 'text', text: `Moved: ${from} → ${to}` }] }
    },
  }
}
