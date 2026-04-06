import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '../ScopeResolver'
import { TFile } from 'obsidian'

export function createCopyFileTool(): AgentTool {
  return {
    name: 'cp',
    label: 'Copy File',
    description: 'Copy a file to a new location. Source must be in workspace scope.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source file path' },
        to: { type: 'string', description: 'Destination file path' },
      },
      required: ['from', 'to'],
    },
    execute: async (_id, params) => {
      const { from, to } = params as { from: string; to: string }
      if (!ScopeResolver.getInstance().isInScope(from)) {
        throw new Error(`Access denied: ${from} is not in workspace scope`)
      }
      const { app } = GlobalStore.getInstance()
      const file = app.vault.getAbstractFileByPath(from)
      if (!(file instanceof TFile)) throw new Error(`File not found: ${from}`)
      if (app.vault.getAbstractFileByPath(to)) throw new Error(`Destination exists: ${to}`)
      const content = await app.vault.read(file)
      await app.vault.create(to, content)
      ScopeResolver.getInstance().invalidate()
      return { content: [{ type: 'text', text: `Copied: ${from} → ${to}` }] }
    },
  }
}
